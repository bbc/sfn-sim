import { test, expect, describe } from 'vitest';
import runChoice, { evaluateChoiceRule } from '../src/choice.js';
import { NoChoiceMatchedError } from '../src/errors.js';

describe('runChoice', () => {
  test('returns a matched step from the given Choices', () => {
    const state = {
      Type: 'Choice',
      Choices: [
        {
          Variable: '$.someString',
          StringEquals: 'Hello!',
          Next: 'MatchedStep',
        },
      ],
      Default: 'DefaultStep',
    };

    const input = {
      someString: 'Hello!',
    };

    const nextState = runChoice(state, {}, input);

    expect(nextState).toEqual('MatchedStep');
  });

  test('returns the Default step when no choices match', () => {
    const state = {
      Type: 'Choice',
      Choices: [
        {
          Variable: '$.someString',
          StringEquals: 'Hello!',
          Next: 'MatchedStep',
        },
      ],
      Default: 'DefaultStep',
    };

    const input = {
      someString: 'Goodbye!',
    };

    const nextState = runChoice(state, {}, input);

    expect(nextState).toEqual('DefaultStep');
  });

  test('throws a States.NoChoiceMatched error when no choices match and no Default is specified', () => {
    const state = {
      Type: 'Choice',
      Choices: [
        {
          Variable: '$.someString',
          StringEquals: 'Hello!',
          Next: 'MatchedStep',
        },
      ],
    };

    const input = {
      someString: 'Goodbye!',
    };

    expect(() => runChoice(state, {}, input)).toThrowError(NoChoiceMatchedError);
  });
});

describe('evaluateChoiceRule', () => {
  describe('Not', () => {
    const choice = {
      Not: {
        BooleanEquals: true,
        Variable: '$.myBoolean',
      },
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myBoolean: false });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice, { myBoolean: true });
      expect(result).toBe(false);
    });
  });

  describe('Or', () => {
    const choice = {
      Or: [
        {
          BooleanEquals: true,
          Variable: '$.myBooleanA',
        },
        {
          BooleanEquals: true,
          Variable: '$.myBooleanB',
        },
      ],
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myBooleanA: false, myBooleanB: true });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice, { myBooleanA: false, myBooleanB: false });
      expect(result).toBe(false);
    });
  });

  describe('And', () => {
    const choice = {
      And: [
        {
          BooleanEquals: true,
          Variable: '$.myBooleanA',
        },
        {
          BooleanEquals: true,
          Variable: '$.myBooleanB',
        },
      ],
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myBooleanA: true, myBooleanB: true });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice, { myBooleanA: true, myBooleanB: false });
      expect(result).toBe(false);
    });
  });

  describe('StringEquals', () => {
    const choice = {
      StringEquals: 'myValue',
      Variable: '$.myString',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myString: 'myValue' });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice, { myString: 'someOtherValue' });
      expect(result).toBe(false);
    });
  });

  describe('NumericEquals', () => {
    const choice = {
      NumericEquals: 2,
      Variable: '$.myNumber',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myNumber: 2 });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myNumber: 3 });
      expect(result).toBe(false);
    });
  });

  describe('BooleanEquals', () => {
    const choice = {
      BooleanEquals: true,
      Variable: '$.myBoolean',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myBoolean: true });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myBoolean: false });
      expect(result).toBe(false);
    });
  });

  describe('TimestampEquals', () => {
    const date = new Date();
    const choice = {
      TimestampEquals: date.toISOString(),
      Variable: '$.myTimestamp',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myTimestamp: date.toISOString() });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const otherTimestamp = new Date(new Date().setDate(date.getDate() - 5)).toISOString();
      const result = evaluateChoiceRule(choice,{ myTimestamp: otherTimestamp });
      expect(result).toBe(false);
    });
  });

  describe('StringEqualsPath', () => {
    const choice = {
      StringEqualsPath: '$.myStringA',
      Variable: '$.myStringB',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myStringA: 'myValue', myStringB: 'myValue' });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice, { myStringA: 'myValue', myStringB: 'someOtherValue' });
      expect(result).toBe(false);
    });
  });

  describe('NumericEqualsPath', () => {
    const choice = {
      NumericEqualsPath:'$.myNumberA',
      Variable: '$.myNumberB',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myNumberA: 2, myNumberB: 2 });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myNumberA: 2, myNumberB: 3 });
      expect(result).toBe(false);
    });
  });

  describe('BooleanEqualsPath', () => {
    const choice = {
      BooleanEqualsPath: '$.myBooleanA',
      Variable: '$.myBooleanB',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myBooleanA: true, myBooleanB: true });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myBooleanA: true, myBooleanB: false });
      expect(result).toBe(false);
    });
  });

  describe('TimestampEqualsPath', () => {
    const choice = {
      TimestampEqualsPath: '$.myTimestampA',
      Variable: '$.myTimestampB',
    };

    test('returns true', () => {
      const timestamp = new Date().toISOString();
      const result = evaluateChoiceRule(choice, { myTimestampA: timestamp, myTimestampB: timestamp });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const date = new Date();
      const myTimestampA = date.toISOString();
      const myTimestampB = new Date(new Date().setDate(date.getDate() - 5)).toISOString();
      const result = evaluateChoiceRule(choice,{ myTimestampA, myTimestampB });
      expect(result).toBe(false);
    });
  });

  describe('IsNull', () => {
    const choice = {
      IsNull: true,
      Variable: '$.myVariable',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myVariable: null });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myVariable: 'someValue' });
      expect(result).toBe(false);
    });
  });

  describe('IsPresent', () => {
    const choice = {
      IsPresent: true,
      Variable: '$.myVariable',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myVariable: 'someValue' });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ someOtherVariable: 'someValue' });
      expect(result).toBe(false);
    });
  });

  describe('IsNumeric', () => {
    const choice = {
      IsNumeric: true,
      Variable: '$.myVariable',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myVariable: 2 });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myVariable: 'two' });
      expect(result).toBe(false);
    });
  });

  describe('IsString', () => {
    const choice = {
      IsString: true,
      Variable: '$.myVariable',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myVariable: 'hello' });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myVariable: 42 });
      expect(result).toBe(false);
    });
  });

  describe('IsBoolean', () => {
    const choice = {
      IsBoolean: true,
      Variable: '$.myVariable',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myVariable: false });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myVariable: 'TRUE' });
      expect(result).toBe(false);
    });
  });

  describe('IsTimestamp', () => {
    const choice = {
      IsTimestamp: true,
      Variable: '$.myVariable',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myVariable: new Date().toISOString() });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myVariable: '24th June 2024' });
      expect(result).toBe(false);
    });
  });

  describe('StringMatches', () => {
    const choice = {
      StringMatches: '*.test.js',
      Variable: '$.myString',
    };

    test('returns true', () => {
      const result = evaluateChoiceRule(choice, { myString: 'tests/choice.test.js' });
      expect(result).toBe(true);
    });

    test('returns false', () => {
      const result = evaluateChoiceRule(choice,{ myString: 'src/choice.js' });
      expect(result).toBe(false);
    });
  });
});
