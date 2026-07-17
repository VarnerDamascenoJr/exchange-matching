import { buildIdPrefixFilter } from './id-filter';

describe('buildIdPrefixFilter', () => {
  it('returns undefined when id is empty', () => {
    expect(buildIdPrefixFilter()).toBeUndefined();
    expect(buildIdPrefixFilter('')).toBeUndefined();
    expect(buildIdPrefixFilter('   ')).toBeUndefined();
  });

  it('builds a startsWith filter for partial ids', () => {
    expect(buildIdPrefixFilter('cmro56zr')).toEqual({
      startsWith: 'cmro56zr',
    });
  });

  it('trims the incoming id value', () => {
    expect(buildIdPrefixFilter('  cmro56zr  ')).toEqual({
      startsWith: 'cmro56zr',
    });
  });
});
