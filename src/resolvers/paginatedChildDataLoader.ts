import { toInputType } from 'graphql-compose';
import type { Resolver, ObjectTypeComposer, InterfaceTypeComposer } from 'graphql-compose';
import type { Model, Document } from 'mongoose';
import {
  perPageHelperArgs,
  pageHelperArgs,
  filterHelper,
  filterHelperArgs,
  perPageHelper,
  pageHelper,
  sortHelper,
  sortHelperArgs,
  projectionHelper,
  prepareNestedAliases,
  prepareAliasesReverse,
  replaceAliases,
  FilterHelperArgsOpts,
  PerPageHelperArgsOpts,
  SortHelperArgsOpts,
} from './helpers';
import type { ExtendedResolveParams } from '../';
import { beforeQueryHelper, beforeQueryHelperLean } from './helpers/beforeQueryHelper';
import { getChildDataLoader } from './helpers/childDataLoaderHelper';
import { PaginationInfoType, PaginationType } from 'graphql-compose-pagination';
import { preparePaginationTC } from '../types/paginationTypes';

type ChildDataLoaderPaginationType<T> = PaginationType & {
  count: number;
  items: T[];
  pageInfo: PaginationInfoType;
};

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DataLoaderResolverOpts {
  /**
   * Enabling the lean option tells Mongoose to skip instantiating
   * a full Mongoose document and just give you the plain JavaScript objects.
   * Documents are much heavier than vanilla JavaScript objects,
   * because they have a lot of internal state for change tracking.
   * The downside of enabling lean is that lean docs don't have:
   *   Default values
   *   Getters and setters
   *   Virtuals
   * Read more about `lean`: https://mongoosejs.com/docs/tutorials/lean.html
   */
  lean?: boolean;
}

type TArgs<T> = {
  _id: T;
  filter?: any;
  perPage?: number;
  page?: number;
  sort?: string | string[] | Record<string, any>;
};

export type perPageHelperArgsOpts = {
  /**
   * Set the default number of items returned per page if one is not provided in the query.
   * By default, this will be 20.
   */
  defaultPerPage?: number;
};

export interface PaginatedChildDataLoaderResolverOpts extends DataLoaderResolverOpts {
  parentSelector: string;
  /** If you want to generate different resolvers you may avoid Type name collision by adding a suffix to type names */
  suffix?: string;
  /** Customize input-type for `filter` argument. If `false` then arg will be removed. */
  filter?: FilterHelperArgsOpts | false;
  sort?: SortHelperArgsOpts | false;
  perPage?: PerPageHelperArgsOpts | false;
  page?: false;
}

export function paginatedChildDataLoader<TSource, TContext, TDoc extends Document<T>, T = string>(
  model: Model<TDoc>,
  tc: ObjectTypeComposer<TDoc, TContext> | InterfaceTypeComposer<TDoc, TContext>,
  opts: PaginatedChildDataLoaderResolverOpts
): Resolver<TSource, TContext, TArgs<T>, TDoc> {
  if (!model || !model.modelName || !model.schema) {
    throw new Error(
      'First arg for Resolver childDataLoader() should be instance of Mongoose Model.'
    );
  }

  if (!tc || tc.constructor.name !== 'ObjectTypeComposer') {
    throw new Error(
      'Second arg for Resolver childDataLoader() should be instance of ObjectTypeComposer.'
    );
  }

  const aliases = prepareNestedAliases(model.schema);
  const aliasesReverse = prepareAliasesReverse(model.schema);

  return tc.schemaComposer.createResolver<TSource, TArgs<T>>({
    type: preparePaginationTC(tc, 'paginatedChildDataLoader'),
    name: 'paginatedChildDataLoader',
    kind: 'query',
    args: {
      _id: tc.hasField('_id') ? toInputType(tc.getFieldTC('_id')) : 'MongoID', // TODO: should this be '_ids' instead since this is a find many?
      ...filterHelperArgs(tc, model, {
        prefix: 'FilterFindMany',
        suffix: `${opts?.suffix || ''}Input`,
        ...opts?.filter,
      }),
      ...perPageHelperArgs({
        ...opts?.perPage,
      }),
      ...pageHelperArgs(),
      ...sortHelperArgs(tc, model, {
        sortTypeName: `SortFindMany${tc.getTypeName()}${opts?.suffix || ''}Input`,
        ...opts?.sort,
      }),
    },
    resolve: ((resolveParams: ExtendedResolveParams<TDoc>) => {
      const args = resolveParams.args || {};
      const projection = resolveParams.projection || {};
      projection[opts.parentSelector] = true;
      resolveParams.projection = projection;

      if (!args._id) {
        return Promise.resolve(null);
      }

      if (!resolveParams.info) {
        throw new Error(
          `Cannot use ${tc.getTypeName()}.dataLoader resolver without 'info: GraphQLResolveInfo'`
        );
      }

      const blf = async (ids: ReadonlyArray<T>) => {
        const searchCriteria = {
          [opts.parentSelector]: { $in: ids },
        };
        // @ts-ignore
        resolveParams.query = model.find(searchCriteria);
        resolveParams.model = model;
        filterHelper(resolveParams, aliases);
        sortHelper(resolveParams);

        const projection = resolveParams.projection || {};
        delete projection.pageInfo;
        const newProjection: typeof projection = {};
        for (const [key, value] of Object.entries(projection.items || {})) {
          newProjection[key] = value;
        }
        delete projection.items;
        delete projection.count;

        for (const [key, value] of Object.entries(projection || {})) {
          newProjection[key] = value;
        }

        resolveParams.projection = newProjection;

        projectionHelper(resolveParams, aliases);

        if (opts?.lean) {
          const result = (await beforeQueryHelperLean(resolveParams)) || [];
          return Array.isArray(result) && aliasesReverse
            ? result.map((r) => replaceAliases(r, aliasesReverse))
            : result;
        } else {
          return beforeQueryHelper(resolveParams).then((res) => res || []);
        }
      };

      const dl = getChildDataLoader(
        resolveParams.context,
        resolveParams.info,
        opts.parentSelector,
        blf
      );

      return dl.load(args._id).then((res) => {
        const perPage = perPageHelper(resolveParams);
        let page = pageHelper(resolveParams);
        let pageCount = 0;
        let itemCount = 0;
        let items: Model<TDoc>[];
        if (res) {
          pageCount = Math.ceil(res.length / perPage);
          page = Math.min(page, pageCount);
          itemCount = res.length;
          const start = Math.max((page - 1) * perPage, 0);
          const end = page > 0 ? Math.min(start + perPage, res.length) : res.length;
          items = res.slice(start, end) as any as Model<TDoc>[];
        } else {
          items = [];
        }

        const pageInfo: PaginationInfoType = {
          currentPage: page,
          perPage,
          itemCount,
          pageCount,
          hasPreviousPage: page > 1,
          hasNextPage: page < pageCount,
        };
        const result: ChildDataLoaderPaginationType<Model<TDoc>> = {
          count: itemCount,
          items,
          pageInfo,
        };
        return result;
      });
    }) as never,
  });
}

export function getPaginatedChildDataLoaderResolver<
  TSource,
  TContext,
  TDoc extends Document<T>,
  T = string
>(
  model: Model<TDoc>,
  tc: ObjectTypeComposer<TDoc, TContext> | InterfaceTypeComposer<TDoc, TContext>
): (opts: PaginatedChildDataLoaderResolverOpts) => Resolver<TSource, TContext> {
  const typedFn: (
    model: Model<TDoc>,
    tc: ObjectTypeComposer<TDoc, TContext> | InterfaceTypeComposer<TDoc, TContext>,
    opts: PaginatedChildDataLoaderResolverOpts
  ) => Resolver<TSource, TContext, TArgs<T>, TDoc> = paginatedChildDataLoader;
  return typedFn.bind(undefined, model, tc);
}
