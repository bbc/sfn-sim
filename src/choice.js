import { NoChoiceMatchedError, RuntimeError } from './errors.js';
import { getValue } from './utils.js';

const runChoice = (state, _context, input) => {
  for (const choice of state.Choices) {
    if (evaluateChoiceRule(choice, input)) {
      return choice.Next;
    }
  }

  if (state.Default) {
    return state.Default;
  }

  throw new NoChoiceMatchedError();
};

const evaluateChoiceRule = (choice, input) => {
  if (choice.Not) {
    return !evaluateChoiceRule(choice.Not, input);
  }

  if (choice.Or) {
    return choice.Or.some((subChoice) => evaluateChoiceRule(subChoice, input));
  }

  if (choice.And) {
    return choice.And.every((subChoice) => evaluateChoiceRule(subChoice, input));
  }

  if (choice.StringEquals || choice.NumericEquals || choice.BooleanEquals || choice.TimestampEquals) {
    const operand = choice.StringEquals || choice.NumericEquals || choice.BooleanEquals || choice.TimestampEquals;
    return getValue(input, choice.Variable) === operand;
  }

  if (choice.StringEqualsPath || choice.NumericEqualsPath || choice.BooleanEqualsPath || choice.TimestampEqualsPath) {
    const operandPath = choice.StringEqualsPath || choice.NumericEqualsPath || choice.BooleanEqualsPath || choice.TimestampEqualsPath;
    return getValue(input, choice.Variable) === getValue(input, operandPath);
  }

  if (choice.StringLessThan || choice.NumericLessThan || choice.TimestampLessThan) {
    const operand = choice.StringLessThan || choice.NumericLessThan || choice.TimestampLessThan;
    return getValue(input, choice.Variable) < operand;
  }

  if (choice.StringLessThanPath || choice.NumericLessThanPath || choice.TimestampLessThanPath) {
    const operandPath = choice.StringLessThanPath || choice.NumericLessThanPath || choice.TimestampLessThanPath;
    return getValue(input, choice.Variable) < getValue(input, operandPath);
  }

  if (choice.StringLessThanEqual || choice.NumericLessThanEqual || choice.TimestampLessThanEqual) {
    const operand = choice.StringLessThanEqual || choice.NumericLessThanEqual || choice.TimestampLessThanEqual;
    return getValue(input, choice.Variable) <= operand;
  }

  if (choice.StringLessThanEqualPath || choice.NumericLessThanEqualPath || choice.TimestampLessThanEqualPath) {
    const operandPath = choice.StringLessThanEqualPath || choice.NumericLessThanEqualPath || choice.TimestampLessThanEqualPath;
    return getValue(input, choice.Variable) <= getValue(input, operandPath);
  }

  if (choice.StringGreaterThan || choice.NumericGreaterThan || choice.TimestampGreaterThan) {
    const operand = choice.StringGreaterThan || choice.NumericGreaterThan || choice.TimestampGreaterThan;
    return getValue(input, choice.Variable) > operand;
  }

  if (choice.StringGreaterThanPath || choice.NumericGreaterThanPath || choice.TimestampGreaterThanPath) {
    const operandPath = choice.StringGreaterThanPath || choice.NumericGreaterThanPath || choice.TimestampGreaterThanPath;
    return getValue(input, choice.Variable) > getValue(input, operandPath);
  }

  if (choice.StringGreaterThanEqual || choice.NumericGreaterThanEqual || choice.TimestampGreaterThanEqual) {
    const operand = choice.StringGreaterThanEqual || choice.NumericGreaterThanEqual || choice.TimestampGreaterThanEqual;
    return getValue(input, choice.Variable) >= operand;
  }

  if (choice.StringGreaterThanEqualPath || choice.NumericGreaterThanEqualPath || choice.TimestampGreaterThanEqualPath) {
    const operandPath = choice.StringGreaterThanEqualPath || choice.NumericGreaterThanEqualPath || choice.TimestampGreaterThanEqualPath;
    return getValue(input, choice.Variable) >= getValue(input, operandPath);
  }

  if (choice.IsNull !== undefined) {
    return (getValue(input, choice.Variable) === null) === choice.IsNull;
  }

  if (choice.IsPresent !== undefined) {
    return !!getValue(input, choice.Variable) === choice.IsPresent;
  }

  if (choice.IsNumeric !== undefined) {
    return (typeof getValue(input, choice.Variable) === 'number') === choice.IsNumeric;
  }

  if (choice.IsString !== undefined) {
    return (typeof getValue(input, choice.Variable) === 'string') === choice.IsString;
  }

  if (choice.IsBoolean !== undefined) {
    return (typeof getValue(input, choice.Variable) === 'boolean') === choice.IsBoolean;
  }

  if (choice.IsTimestamp !== undefined) {
    const timestamp = new RegExp(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|((\+|-)\d{2}:\d{2}))$/);
    return timestamp.test(getValue(input, choice.Variable)) === choice.IsTimestamp;
  }

  if (choice.StringMatches) {
    const matcher = choice.StringMatches;
    const string = getValue(input, choice.Variable);

    const parts = matcher
      .replace(/\\\*/g, 'ESCAPED_ASTERISK')
      .split('*')
      .map((part) => part.replace(/ESCAPED_ASTERISK/g, '\*'));

    let valid = true;
    let previousIndex = 0;

    for (const part of parts) {
      if (!(string.indexOf(part) >= previousIndex)) {
        valid = false;
      }

      previousIndex = string.indexOf(part) + part.length;
    }

    return valid;
  }

  throw new RuntimeError('Choice does not contain a data-test expression');
};

export default runChoice;

export {
  evaluateChoiceRule,
};
