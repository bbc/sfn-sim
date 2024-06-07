import { test, expect } from 'vitest';
import { IntrinsicFailureError } from '../src/errors.js';
import { applyFunction } from '../src/intrinsics.js';

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

test('throws a States.IntrinsicFailure error if no intrinsic function is matched', () => {
  expect(() => applyFunction({}, 'States.Compare($.apples, $.oranges)')).toThrowError(IntrinsicFailureError);
});
