import dataloader from 'dataloader'
import { Client } from '@elastic/elasticsearch'
import HttpAgent, { HttpsAgent } from 'agentkeepalive'
import { SearchkitConfig } from '../resolvers'
import QueryManager from './QueryManager'
import { filterTransform } from './FacetsFns'

export interface SearchResponse<T> {
  took: number
  timed_out: boolean
  hits: {
    total: {
      value: number
    }
    max_score: number
    hits: Array<{
      _id: number
      _source: any
      fields?: any
      highlight?: any
      inner_hits?: any
      matched_queries?: string[]
      sort?: string[]
    }>
  }
  aggregations?: any
}

export type Query = {
  bool?: {
    must?: Array<Record<string, unknown>>
    should?: Array<Record<string, unknown>>
    filter?: Array<Record<string, unknown>>
  }
}

type BaseQuery = {
  size: number
  query?: Query
  post_filter?: Query
}

export const mergeESQueries = (queries) =>
  queries.reduce(
    (combinedQuery, partial) => ({
      ...combinedQuery,
      ...partial,
      aggs: {
        ...combinedQuery.aggs,
        ...partial.aggs
      }
    }),
    {}
  )

const keepaliveHttpsAgent = new HttpsAgent()
const keepaliveAgent = new HttpAgent()

export default class SearchkitRequest {
  private dataloader: any
  private client: Client

  constructor(
    private queryManager: QueryManager,
    private config: SearchkitConfig,
    private baseFilters: Array<Record<string, unknown>>
  ) {
    this.client = new Client({
      node: this.config.host,
      agent: () =>
        new URL(this.config.host).protocol === 'http:' ? keepaliveAgent : keepaliveHttpsAgent
    })

    this.dataloader = new dataloader(async (partialQueries) => {
      const query = this.buildQuery(partialQueries)
      const esQuery = this.config.postProcessRequest ? this.config.postProcessRequest(query) : query
      const response = await this.executeQuery(esQuery)
      return partialQueries.map(() => response)
    })
  }

  public async search(partialQuery): Promise<SearchResponse<any>> {
    return this.dataloader.load(partialQuery)
  }

  private buildQuery(partialQueries): BaseQuery {
    const queryFilter =
      this.queryManager.hasQuery() && this.config.query
        ? this.config.query.getFilter(this.queryManager)
        : null

    const hasBaseFilters = this.baseFilters?.length
    const query: Query = queryFilter || (hasBaseFilters ? {} : null)

    if (hasBaseFilters) {
      if (query.bool) {
        Object.assign(query.bool, {
          filter: query.bool.filter?.length
            ? [].concat(query.bool.filter, this.baseFilters)
            : this.baseFilters
        })
      } else {
        Object.assign(query, { bool: { filter: this.baseFilters } })
      }
    }

    const combinedFilterConfigs = [...(this.config.facets || []), ...(this.config.filters || [])]
    const postFilter = filterTransform(this.queryManager, combinedFilterConfigs)

    let highlight
    this.config.hits.highlightedFields?.forEach((field) => {
      if (!highlight) {
        highlight = { fields: {} }
      }
      if (typeof field == 'string') {
        highlight.fields[field] = {}
      } else {
        highlight.fields[field.field] = field.config
      }
    })

    const baseQuery = { size: 0 }

    return mergeESQueries(
      [
        baseQuery,
        query && { query },
        postFilter && { post_filter: postFilter },
        highlight && { highlight },
        ...(partialQueries as any[])
      ].filter(Boolean)
    )
  }

  private async executeQuery(esQuery): Promise<SearchResponse<any>> {
    try {
      const response = await this.client.search<SearchResponse<any>>({
        index: this.config.index,
        body: esQuery
      })

      return response.body
    } catch (e) {
      console.log(e)
    }
  }
}
