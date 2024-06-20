import { validate as validateUUID } from 'uuid';
import { test, expect } from 'vitest';
import { IntrinsicFailureError } from '../src/errors.js';
import { applyFunction } from '../src/intrinsics.js';

test('applies the States.Format function', () => {
  const input = {
    someKey: 'someValue',
  };

  const result = applyFunction(input, `States.Format('My number is {}, my value\\'s {}', 2, $.someKey)`);

  expect(result).toEqual(`My number is 2, my value\\'s someValue`);
});

test('applies the States.StringToJson function', () => {
  const input = {
    someObjectString: '{ "someKey": "someValue" }',
  };

  const result = applyFunction(input, 'States.StringToJson($.someObjectString)');

  expect(result).toEqual({ someKey: 'someValue' });
});

test('applies the States.JsonToString function', () => {
  const input = {
    someObject: {
      someKey: 'someValue',
    },
  };

  const result = applyFunction(input, 'States.JsonToString($.someObject)');

  expect(result).toEqual('{"someKey":"someValue"}');
});

test('applies the States.Array function', () => {
  const input = {
    one: 1,
    two: 2,
    three: 3,
  };

  const result = applyFunction(input, 'States.Array($.one, $.two, $.three)');

  expect(result).toEqual([1, 2, 3]);
});

test('applies the States.ArrayPartition function', () => {
  const input = {
    alphabet: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  };

  const result = applyFunction(input, 'States.ArrayPartition($.alphabet, 3)');

  expect(result).toEqual([['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]);
});

test('applies the States.ArrayContains function', () => {
  const input = {
    alphabet: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  };

  const result = applyFunction(input, 'States.ArrayContains($.alphabet, e)');

  expect(result).toEqual(true);
});

test('applies the States.ArrayRange function', () => {
  const result = applyFunction({}, 'States.ArrayRange(1, 9, 2)');

  expect(result).toEqual([1, 3, 5, 7, 9]);
});

test('applies the States.ArrayGetItem function', () => {
  const input = {
    alphabet: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  };

  const result = applyFunction(input, 'States.ArrayGetItem($.alphabet, 4)');

  expect(result).toEqual('e');
});

test('applies the States.ArrayLength function', () => {
  const input = {
    alphabet: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  };

  const result = applyFunction(input, 'States.ArrayLength($.alphabet)');

  expect(result).toEqual(7);
});

test('applies the States.ArrayUnique function', () => {
  const input = {
    letters: ['a', 'a', 'a', 'b', 'a', 'b', 'c', 'b'],
  };

  const result = applyFunction(input, 'States.ArrayUnique($.letters)');

  expect(result).toEqual(['a', 'b', 'c']);
});

test('applies the States.Base64Encode function', () => {
  const input = {
    data: 'Data to encode',
  };

  const result = applyFunction(input, 'States.Base64Encode($.data)');

  expect(result).toEqual('RGF0YSB0byBlbmNvZGU=');
});

test('applies the States.Base64Decode function', () => {
  const input = {
    data: 'RGVjb2RlZCBkYXRh',
  };

  const result = applyFunction(input, 'States.Base64Decode($.data)');

  expect(result).toEqual('Decoded data');
});

test('applies the States.Hash function', () => {
  const input = {
    data: 'input data',
  };

  const result = applyFunction(input, 'States.Hash($.data, SHA-1)');

  expect(result).toEqual('aaff4a450a104cd177d28d18d74485e8cae074b7');
});

test('applies the States.JsonMerge function', () => {
  const input = {
    json1: {
      a: {
        a1: 1,
        a2: 2,
      },
      b: 2,
    },
    json2: {
      a: {
        a3: 1,
        a4: 2,
      },
      c: 3,
    },
  };

  const result = applyFunction(input, 'States.JsonMerge($.json1, $.json2, false)');

  expect(result).toEqual({
    a: {
      a3: 1,
      a4: 2,
    },
    b: 2,
    c: 3,
  });
});

test('applies the States.MathRandom function', () => {
  const result = applyFunction({}, 'States.MathRandom(1, 999, hello)');

  expect(result).toEqual(546);
});

test('applies the States.MathAdd function', () => {
  const input = {
    negative: -2,
  };
  const result = applyFunction(input, 'States.MathAdd(8, $.negative)');

  expect(result).toEqual(6);
});

test('applies the States.StringSplit function', () => {
  const input = {
    string: 'a,b,c,d',
    separator: ',',
  };
  const result = applyFunction(input, 'States.StringSplit($.string, $.separator)');

  expect(result).toEqual(['a', 'b', 'c', 'd']);
});

test('applies the States.UUID function', () => {
  const result = applyFunction({}, 'States.UUID()');

  expect(validateUUID(result)).toBe(true);
});

test('throws a States.IntrinsicFailure error if no intrinsic function is matched', () => {
  expect(() => applyFunction({}, 'States.Compare($.apples, $.oranges)')).toThrowError(IntrinsicFailureError);
});
