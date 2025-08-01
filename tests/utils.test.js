import { test, expect, describe } from 'vitest';
import { applyPayloadTemplate, getStateResult, getValue, setValue, evaluateJSONata, getJSONataInput, getJSONataOutput, assign } from '../src/utils.js';

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

    const context = {
      StateMachine: {
        Name: 'cool-state-machine',
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

    const result = applyPayloadTemplate(input, context, payloadTemplate);

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
    expect(applyPayloadTemplate({ someKey: 'someValue' })).toEqual({ someKey: 'someValue' });
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

describe('evaluateJSONata', () => {
  const expression = '$sum($example.value)';

  const data = {
    example: [
      { value: 4 },
      { value: 7 },
      { value: 13 },
    ],
  };

  test('returns a plain string value', async () => {
    expect(await evaluateJSONata('my test string', data)).toEqual('my test string');
  });

  test('evaluates a single JSONata expression', async () => {
    const value = `{% ${expression} %}`;

    expect(await evaluateJSONata(value, data)).toEqual(24);
  });

  test('evaluates nested values in objects and arrays', async () => {
    const value = {
      myString: 'my test string',
      myNumber: 42,
      myBoolean: true,
      myExpression: `{% ${expression} %}`,
      myObject: {
        myString: 'my test string',
        myExpression: `{% ${expression} %}`,
        myArray: [
          'my test string',
          `{% ${expression} %}`,
        ],
      },
    };

    expect(await evaluateJSONata(value, data)).toEqual({
      myString: 'my test string',
      myNumber: 42,
      myBoolean: true,
      myExpression: 24,
      myObject: {
        myString: 'my test string',
        myExpression: 24,
        myArray: [
          'my test string',
          24,
        ],
      },
    });
  });
});

describe('getJSONataInput', () => {
  const expression = '$sum($example.value)';

  const variables = {
    states: {
      input: {
        myInput: 1,
      },
    },
    example: [
      { value: 4 },
      { value: 7 },
      { value: 13 },
    ],
  };

  test('gets input from state.Arguments', async () => {
    const state = {
      Arguments: {
        myArgument: `{% ${expression} %}`,
      },
    };

    expect(await getJSONataInput(state, variables)).toEqual({
      myArgument: 24,
    });
  });

  test('defaults to state input without state.Arguments', async () => {
    const state = {};

    expect(await getJSONataInput(state, variables)).toEqual({
      myInput: 1,
    });
  });
});

describe('getJSONataOutput', () => {
  const expression = '$sum($example.value)';

  const variables = {
    states: {
      input: {
        myInput: 1,
      },
    },
    example: [
      { value: 4 },
      { value: 7 },
      { value: 13 },
    ],
  };

  test('gets output from state.Output', async () => {
    const state = {
      Output: {
        myOutput: `{% ${expression} %}`,
      },
    };

    expect(await getJSONataOutput(state, variables)).toEqual({
      myOutput: 24,
    });
  });

  test('returns given default without state.Output', async () => {
    const state = {};

    const defaultOutput = {
      myDefault: 2,
    };

    expect(await getJSONataOutput(state, variables, defaultOutput)).toEqual({
      myDefault: 2,
    });
  });

  test('defaults to state input without state.Arguments or given default', async () => {
    const state = {};

    expect(await getJSONataOutput(state, variables)).toEqual({
      myInput: 1,
    });
  });
});

describe('assign', () => {
  test('assigns given variables', async () => {
    const state = {
      Assign: {
        myString: 'new string',
        myExpression: '{% $myExistingVariable %}',
      },
    };

    const variables = {
      myString: 'replace me',
      myExistingVariable: 'hello',
    };

    await assign(state, variables);

    expect(variables).toEqual({
      myExistingVariable: 'hello',
      myString: 'new string',
      myExpression: 'hello',
    });
  });

  test(`doesn't assign the reserved states variable`, async () => {
    const state = {
      Assign: {
        states: 'something else',
      },
    };

    const variables = {
      states: 'important stuff'
    };

    await assign(state, variables);

    expect(variables).toEqual({
      states: 'important stuff'
    });
  });

  test(`doesn't assign anything without state.Assign`, async () => {
    const state = {};

    const variables = {
      states: 'important stuff',
      myVariable: 'hello',
    };

    await assign(state, variables);

    expect(variables).toEqual({
      states: 'important stuff',
      myVariable: 'hello',
    });
  });
});
