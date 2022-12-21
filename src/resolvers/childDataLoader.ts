import { toInputType } from 'graphql-compose';
import type { Resolver, ObjectTypeComposer, InterfaceTypeComposer } from 'graphql-compose';
import { ObjectTypeComposer as OTC, InterfaceTypeComposer as ITC } from 'graphql-compose';
import type { Model, Document } from 'mongoose';
import {
  limitHelperArgs,
  skipHelperArgs,
  filterHelper,
  filterHelperArgs,
  sortHelper,
  sortHelperArgs,
  projectionHelper,
  prepareNestedAliases,
  prepareAliasesReverse,
  replaceAliases,
  FilterHelperArgsOpts,
  SortHelperArgsOpts,
  LimitHelperArgsOpts,
} from './helpers';
import type { ExtendedResolveParams } from '../';
import { beforeQueryHelper, beforeQueryHelperLean } from './helpers/beforeQueryHelper';
import { getChildDataLoader } from './helpers/childDataLoaderHelper';
import { DiscriminatorTypeComposer } from "../";

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
  limit?: number;
  skip?: number;
  sort?: string | string[] | Record<string, any>;
};

export interface ChildDataLoaderResolverOpts extends DataLoaderResolverOpts {
  parentSelector: string;
  /** If you want to generate different resolvers you may avoid Type name collision by adding a suffix to type names */
  suffix?: string;
  /** Customize input-type for `filter` argument. If `false` then arg will be removed. */
  filter?: FilterHelperArgsOpts | false;
  sort?: SortHelperArgsOpts | false;
  limit?: LimitHelperArgsOpts | false;
  skip?: false;
}

export function childDataLoader<TSource, TContext, TDoc extends Document<T>, T = string>(
  model: Model<TDoc>,
  tc: ObjectTypeComposer<TDoc, TContext> | InterfaceTypeComposer<TDoc, TContext>,
  opts: ChildDataLoaderResolverOpts,
): Resolver<TSource, TContext, TArgs<T>, TDoc> {
  if (!model || !model.modelName || !model.schema) {
    throw new Error(
      'First arg for Resolver childDataLoader() should be instance of Mongoose Model.'
    );
  }

  if (!tc || !(tc instanceof OTC || tc instanceof ITC)) {
    throw new Error(
      'Second arg for Resolver childDataLoader() should be instance of ObjectTypeComposer or InterfaceTypeComposer.'
    );
  }

  const aliases = prepareNestedAliases(model.schema);
  const aliasesReverse = prepareAliasesReverse(model.schema);

  const type =
    tc instanceof DiscriminatorTypeComposer
      ? tc.getInterfaces()[0].NonNull.List.NonNull // `[${tc.getInterfaces()[0].getTypeName()}!]!`
      : tc.List.NonNull;

  return tc.schemaComposer.createResolver<TSource, TArgs<T>>({
    type: type,
    name: 'childDataLoader',
    kind: 'query',
    args: {
      _id: tc.hasField('_id') ? toInputType(tc.getFieldTC('_id')) : 'MongoID', // TODO: should this be '_ids' instead since this is a find many?
      ...filterHelperArgs(tc, model, {
        prefix: 'FilterFindMany',
        suffix: `${opts?.suffix || ''}Input`,
        ...opts?.filter,
      }),
      ...skipHelperArgs(),
      ...limitHelperArgs({
        ...opts?.limit,
      }),
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
        if (res) {
          const start = resolveParams.args.skip || 0;
          const end = resolveParams.args.limit
            ? Math.min(start + resolveParams.args.limit, res.length)
            : res.length;
          return res.slice(start, end);
        } else {
          return [];
        }
      });
    }) as never,
  });
}

export function getChildDataLoaderResolver<TSource, TContext, TDoc extends Document<T>, T = string>(
  model: Model<TDoc>,
  tc: ObjectTypeComposer<TDoc, TContext> | InterfaceTypeComposer<TDoc, TContext>
): (opts: ChildDataLoaderResolverOpts) => Resolver<TSource, TContext> {
  const typedFn: (
    model: Model<TDoc>,
    tc: ObjectTypeComposer<TDoc, TContext> | InterfaceTypeComposer<TDoc, TContext>,
    opts: ChildDataLoaderResolverOpts
  ) => Resolver<TSource, TContext, TArgs<T>, TDoc> = childDataLoader;
  return typedFn.bind(undefined, model, tc);
}
