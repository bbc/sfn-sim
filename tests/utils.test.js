import { test, expect, describe } from 'vitest';
import { applyPayloadTemplate, getStateResult, getValue, setValue } from '../src/utils.js';

describe('getValue', () => {
  test('gets a value from an object', () => {
    expect(getValue({ someKey: 'someValue' }, '$.someKey')).toEqual('someValue');
  });

  test('gets an array value from an object', () => {
    expect(getValue({ someArray: [1, 2, 3] }, '$.someArray.[1]')).toEqual(2);
  });

  test('defaults to the whole object', () => {
    expect(getValue({ someKey: 'someValue' })).toEqual({ someKey: 'someValue' });
  });
});

describe('setValue', () => {
  test('sets a value in an object', () => {
    const object = { someKey: 'someValue' };

    setValue(object, '$.someNewKey', 'someNewValue');
    
    expect(object).toEqual({
      someKey: 'someValue',
      someNewKey: 'someNewValue',
    });
  });

  test('sets an array value in an object', () => {
    const object = { someArray: [1, 2, 3] };

    setValue(object, '$.someArray.[1]', 'two');
    
    expect(object).toEqual({
      someArray: [1, 'two', 3],
    });
  });
});

describe('applyPayloadTemplate', () => {
  test('builds a payload', () => {
    const input = {
      one: 1,
      two: 2,
      someObjectString: '{ "someKey": "someValue" }',
    };

    const data = {
      context: {
        StateMachine: {
          Name: 'cool-state-machine',
        },
      },
    };

    const payloadTemplate = {
      static: 'staticValue',
      'inputOne.$': '$.one',
      nested: {
        'inputTwo.$': '$.two',
      },
      'context.$': '$$.StateMachine.Name',
      'intrinsic.$': 'States.StringToJson($.someObjectString)',
    };

    const result = applyPayloadTemplate(input, data, payloadTemplate);

    expect(result).toEqual({
      static: 'staticValue',
      inputOne: 1,
      nested: {
        inputTwo: 2,
      },
      context: 'cool-state-machine',
      intrinsic: {
        someKey: 'someValue',
      },
    });
  });

  test('defaults to returning the input', () => {
    expect(applyPayloadTemplate({ someKey: 'someValue'})).toEqual({ someKey: 'someValue'});
  });
});

describe('getStateResult', () => {
  const input = {
    someInput: 'inputValue',
  };

  const stateResult = {
    someResult: 'resultValue',
  };

  test('adds state result at the specified ResultPath', () => {
    expect(getStateResult(input, stateResult, '$.result')).toEqual({
      someInput: 'inputValue',
      result: {
        someResult: 'resultValue',
      },
    });
  });

  test('overwrites the input with the result when ResultPath is not specified', () => {
    expect(getStateResult(input, stateResult)).toEqual({
      someResult: 'resultValue',
    });
  });

  test('discards the result when ResultPath is null', () => {
    expect(getStateResult(input, stateResult, null)).toEqual({
      someInput: 'inputValue',
    });
  });
});
