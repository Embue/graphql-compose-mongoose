import { getFilterHelperArgOptsMap } from './filter';
import { getLimitHelperArgsOptsMap } from './limit';
import { getRecordHelperArgsOptsMap } from './record';

export * from './aliases';
export * from './filter';
export * from './limit';
export * from './projection';
export * from './record';
export * from './skip';
export * from './sort';

export * from './beforeQueryHelper';

export const MergeAbleHelperArgsOpts = {
  sort: 'boolean',
  skip: 'boolean',
  limit: getLimitHelperArgsOptsMap(),
  filter: getFilterHelperArgOptsMap(),
  record: getRecordHelperArgsOptsMap(),
  records: getRecordHelperArgsOptsMap(),
};
