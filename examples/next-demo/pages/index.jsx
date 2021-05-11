import { withSearchkit, SearchkitClient } from '@searchkit/client'
import dynamic from 'next/dynamic'
import withApollo from '../hocs/withApollo'
import '@elastic/eui/dist/eui_theme_light.css'

const Search = dynamic(() => import('../components/index'), { ssr: false })

export default withApollo(withSearchkit(Search, () => {
    const api = new SearchkitClient({
      searchOnLoad: true,
      routing: {
        stateMapping: {
          stateToRoute(searchState) {
            const filters = searchState.filters.reduce((sum, selected) => {
              return {
                ...sum,
                [selected.identifier]: selected.value
              }
            }, {})
            return {
              query: searchState.query,
              sort: searchState.sortBy,
              ...filters
            }
          },
          routeToState(routeState) {
            return {
              query: routeState.query,
              sortBy: routeState.sort,
              filters: routeState.filters
            }
          },
        }
      }
    })

    return api
}))
