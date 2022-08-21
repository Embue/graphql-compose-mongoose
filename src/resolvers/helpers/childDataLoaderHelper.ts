import DataLoader, { BatchLoadFn } from 'dataloader';
import { GraphQLResolveInfo } from 'graphql';

export function getChildDataLoader<
  KeyType extends { equals?: (test: never) => boolean; toString: () => string },
  ParentSelector extends keyof ModelType,
  ModelType extends Record<ParentSelector, KeyType>,
  TContext extends Record<any, any> = any
>(
  context: TContext,
  info: GraphQLResolveInfo,
  parentSelector: keyof ModelType,
  batchLoadFn: BatchLoadFn<KeyType, ModelType>
): DataLoader<KeyType, ModelType[], string> {
  if (!context._gqlDataLoaders) {
    (context as any)._gqlDataLoaders = new WeakMap();
  }

  const { _gqlDataLoaders } = context;

  // for different parts of GraphQL queries, key will be new
  // const dlKey = [
  //   info.parentType.toString(),
  //   info.returnType.toString(),
  //   info.fieldNodes.map((fn: FieldNode) => fn.name.value).join(':'),
  // ];

  const dlKey = info.fieldNodes;

  // get or create DataLoader in GraphQL context
  let dl: DataLoader<KeyType, ModelType[], string> = _gqlDataLoaders.get(dlKey);
  if (!dl) {
    console.log('Did not find data loader!');
    const dataLoaderOptions: DataLoader.Options<KeyType, ModelType[], string> = {
      cacheKeyFn: (k: KeyType): string => {
        if (k?.equals) {
          // Convert ObjectId to string for combining different instances of same ObjectIds.
          // Eg. you have 10 articles with same authorId. So in memory `authorId` for every record
          //     will have its own instance of ObjectID.
          //
          // mongoose will convert them back to ObjectId automatically when call `find` method
          return k.toString();
        }
        return JSON.stringify(k);
      },
    };

    dl = new DataLoader<KeyType, ModelType[], string>(async (parentIds) => {
      const results: ArrayLike<ModelType | Error> = await batchLoadFn(parentIds);

      const resultMap: { [parentId: string]: ModelType[] } = {};

      for (let index = 0; index < results.length; index++) {
        if (results[index] instanceof Error) {
          const error = results[index] as Error;
          console.log(`Error while processing data load function: ${error.message}`);
        } else {
          const childModel: ModelType = results[index] as ModelType;
          const parentId: string = childModel[parentSelector].toString();
          const resultArray: ModelType[] = resultMap[parentId] || [];
          resultMap[parentId] = resultArray;
          resultArray.push(childModel);
        }
      }

      // return docs in the same order as were provided their ids
      return parentIds.map((parentId) => resultMap[parentId.toString()]) || [];
    }, dataLoaderOptions);

    _gqlDataLoaders.set(dlKey, dl);
  }
  return dl;
}
