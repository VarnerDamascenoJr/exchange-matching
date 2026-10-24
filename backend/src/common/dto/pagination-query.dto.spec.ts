import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';
import { OrderBookQueryDto } from '../../market/dto/order-book.query.dto';

describe('PaginationQueryDto', () => {
  it.each([{}, { page: '', pageSize: '' }, { page: null, pageSize: null }])(
    'preserves pagination defaults for %j',
    (input) => {
      const query = plainToInstance(PaginationQueryDto, input);
      expect(validateSync(query)).toEqual([]);
      expect(query).toMatchObject({ page: 1, pageSize: 25 });
    },
  );

  it.each([
    ['1', '1', 1, 1],
    ['2', '100', 2, 100],
    ['0002', '0010', 2, 10],
    [2, 10, 2, 10],
    [String(Number.MAX_SAFE_INTEGER), '1', Number.MAX_SAFE_INTEGER, 1],
    [
      String(Math.floor(Number.MAX_SAFE_INTEGER / 100) + 1),
      '100',
      Math.floor(Number.MAX_SAFE_INTEGER / 100) + 1,
      100,
    ],
  ])(
    'accepts page=%s, pageSize=%s',
    (page, pageSize, expectedPage, expectedSize) => {
      const query = plainToInstance(PaginationQueryDto, { page, pageSize });
      expect(validateSync(query)).toEqual([]);
      expect(query).toMatchObject({
        page: expectedPage,
        pageSize: expectedSize,
      });
    },
  );

  describe.each(['page', 'pageSize'])('%s validation', (field) => {
    it.each(
      [
        '1.5',
        '2abc',
        '1e2',
        '0x10',
        'Infinity',
        '-Infinity',
        'NaN',
        ' ',
        ' 2 ',
        '+2',
        '-1',
        '0',
        '9007199254740992',
        '9007199254740993',
        '99999999999999999999999999999999999999999999',
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        true,
        false,
        ['1', '2'],
        { value: '1' },
      ].map((value) => ({ value })),
    )('rejects $value', ({ value }) => {
      const query = plainToInstance(PaginationQueryDto, { [field]: value });
      expect(
        validateSync(query).some((error) => error.property === field),
      ).toBe(true);
    });
  });

  it('rejects pageSize above the existing limit', () => {
    expect(
      validateSync(plainToInstance(PaginationQueryDto, { pageSize: '101' })),
    ).not.toEqual([]);
  });

  it('rejects an unsafe offset even when each input is a safe integer', () => {
    const query = plainToInstance(PaginationQueryDto, {
      page: String(Number.MAX_SAFE_INTEGER),
      pageSize: '100',
    });
    expect(validateSync(query)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraints: {
            safePaginationOffset: 'Pagination offset must be a safe integer',
          },
        }),
      ]),
    );
  });

  it('applies inherited strict validation to order-book queries without changing filters', () => {
    const valid = plainToInstance(OrderBookQueryDto, {
      side: 'BUY',
      page: '2',
      pageSize: '10',
      price: ' 0.00000001 ',
      id: ' prefix ',
    });
    expect(validateSync(valid)).toEqual([]);
    expect(valid).toMatchObject({
      page: 2,
      pageSize: 10,
      price: '0.00000001',
      id: 'prefix',
    });
    expect(
      validateSync(
        plainToInstance(OrderBookQueryDto, { side: 'SELL', page: '2abc' }),
      ),
    ).not.toEqual([]);
  });
});
