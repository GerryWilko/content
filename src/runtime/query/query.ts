import type { QueryBuilder, SortOptions, ParsedContent } from '../types'
import type { ContentQueryBuilder, ContentQueryBuilderParams, ContentQueryFetcher } from '../types/query'
import { ensureArray } from './match/utils'

const arrayParams = ['sort', 'where', 'only', 'without']

interface QueryOptions {
  initialParams?: ContentQueryBuilderParams
  legacy?: boolean
}

export function createQuery <T = ParsedContent>(fetcher: ContentQueryFetcher<T>, opts: QueryOptions & { legacy: true }): QueryBuilder<T>
export function createQuery <T = ParsedContent>(fetcher: ContentQueryFetcher<T>, opts: QueryOptions & { legacy: false }): ContentQueryBuilder<T>
export function createQuery <T = ParsedContent> (fetcher: ContentQueryFetcher<T>, opts: QueryOptions = {}) {
  const queryParams: ContentQueryBuilderParams = {}

  for (const key of Object.keys(opts.initialParams || {})) {
    queryParams[key] = arrayParams.includes(key) ? ensureArray(opts.initialParams![key]) : opts.initialParams![key]
  }

  /**
   * Factory function to create a parameter setter
   */
  const $set = (key: string, fn: (...values: any[]) => any = v => v) => {
    return (...values: any[]) => {
      queryParams[key] = fn(...values)
      return query
    }
  }

  const resultHooks: ((v: any) => any)[] = []

  const resolveResultHooks = (result: any) => {
    let res = result
    for (const h of resultHooks) {
      res = h(res)
    }
    return res
  }

  const resolveResult = (result: any) => {
    let ret = result
    if (opts.legacy) {
      if (result?.surround) {
        return result.surround
      }

      if (!result) {
        return result
      }

      if ((result as any)?.dirConfig) {
        result.result = {
          _path: (result as any).dirConfig?._path,
          ...(result.result as T),
          _dir: (result as any).dirConfig
        }
      }

      ret = result?._path || Array.isArray(result) || !Object.prototype.hasOwnProperty.call(result, 'result') ? result : result?.result
    }

    if (Array.isArray(ret)) {
      return ret.map(r => resolveResultHooks(r))
    }

    if (ret?._path) {
      return resolveResultHooks(ret)
    }

    return ret
  }

  const query: any = {
    params: () => ({
      ...queryParams,
      ...(queryParams.where ? { where: [...ensureArray(queryParams.where)] } : {}),
      ...(queryParams.sort ? { sort: [...ensureArray(queryParams.sort)] } : {})
    }),
    only: $set('only', ensureArray),
    without: $set('without', ensureArray),
    where: $set('where', (q: any) => [...ensureArray(queryParams.where), ...ensureArray(q)]),
    sort: $set('sort', (sort: SortOptions) => [...ensureArray(queryParams.sort), ...ensureArray(sort)]),
    limit: $set('limit', v => parseInt(String(v), 10)),
    skip: $set('skip', v => parseInt(String(v), 10)),
    // find
    find: () => fetcher(query as unknown as ContentQueryBuilder<T>).then(resolveResult),
    findOne: () => fetcher($set('first')(true)).then(resolveResult),
    count: () => fetcher($set('count')(true)).then(resolveResult),
    // locale
    locale: (_locale: string) => query.where({ _locale }),
    withSurround: $set('surround', (surroundQuery, options) => ({ query: surroundQuery, ...options })),
    withDirConfig: () => $set('dirConfig')(true),
    // hooks
    resultHook: <HT>(h: (v: any) => HT) => { resultHooks.push(h); return query as ContentQueryBuilder<HT> }
  }

  if (opts.legacy) {
    // @ts-ignore
    query.findSurround = (surroundQuery, options) => {
      return query.withSurround(surroundQuery, options).find().then(resolveResult)
    }

    return query as QueryBuilder<T>
  }

  return query as ContentQueryBuilder<T>
}
