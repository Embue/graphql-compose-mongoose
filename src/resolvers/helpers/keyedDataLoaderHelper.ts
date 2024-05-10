import DataLoader, { BatchLoadFn } from 'dataloader';
import { GraphQLResolveInfo } from 'graphql-compose/lib/graphql';

export function getKeyedDataLoader<TContext extends Record<any, any> = any>(
  context: TContext,
  info: GraphQLResolveInfo,
  batchLoadFn: BatchLoadFn<any, any>,
  lookupByKey: string,
): DataLoader<any, any> {
  if (!context._gqlDataLoaders) (context as any)._gqlDataLoaders = new WeakMap();
  const { _gqlDataLoaders } = context;

  // for different parts of GraphQL queries, key will be new
  const dlKey = info.fieldNodes;

  // get or create DataLoader in GraphQL context
  let dl: DataLoader<any, any> = _gqlDataLoaders.get(dlKey);
  if (!dl) {
    const dataLoaderOptions = {
      cacheKeyFn: (k) => {
        if (k?.equals) {
          // Convert ObjectId to string for combining different instances of same ObjectIds.
          // Eg. you have 10 articles with same authorId. So in memory `authorId` for every record
          //     will have its own instance of ObjectID.
          //
          // mongoose will convert them back to ObjectId automatically when call `find` method
          return k.toString();
        }
        return k;
      },
    } as DataLoader.Options<any, any, any>;

    dl = new DataLoader(async (keys) => {
      const result = await batchLoadFn(keys);
      // return docs in the same order as were provided their ids
      return keys.map((key) =>
        (result as any).find((doc: any) => {
          const docKey = doc ? doc[lookupByKey] : undefined;
          if (docKey?.equals) {
            // compare correctly MongoIDs via ObjectID.equals() method
            return docKey.equals(key);
          }
          return docKey === key;
        })
      );
    }, dataLoaderOptions);

    _gqlDataLoaders.set(dlKey, dl);
  }
  return dl;
}
