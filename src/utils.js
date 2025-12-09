import jp from 'jsonpath';
import jsonata from 'jsonata';
import { randomBytes } from 'node:crypto';
import { applyFunction } from './intrinsics.js';

const getTaskToken = () => randomBytes(32).toString('base64');

const getValue = (obj, path = '$') => {
  if (typeof obj !== 'object' && (!path || path === '$')) {
    return obj;
  }
  const jpPath = path.replace(/\.\[/g, '[');
  return jp.value(obj, jpPath);
};

const setValue = (obj, path, newValue) => {
  const jpPath = path.replace(/\.\[/g, '[');
  return jp.value(obj, jpPath, newValue);
};

const applyPayloadTemplate = (input, context, payloadTemplate) => {
  if (!payloadTemplate) {
    return input;
  }

  return getPayload(input, context, payloadTemplate);
};

const getPayload = (input, context, payloadTemplate) => {
  const payload = {};

  for (const key in payloadTemplate) {
    if (typeof payloadTemplate[key] === 'object') {
      payload[key] = getPayload(input, context, payloadTemplate[key]);
    } else {
      if (key.endsWith('.$')) {
        const payloadKey = key.replace('.$', '');

        if (payloadTemplate[key].startsWith('$.') || payloadTemplate[key] == '$') {
          payload[payloadKey] = getValue(input, payloadTemplate[key]);
        } else if (payloadTemplate[key].startsWith('$$.')) {
          payload[payloadKey] = getValue(context, payloadTemplate[key].replace('$$.', '$.'));
        } else {
          payload[payloadKey] = applyFunction(input, payloadTemplate[key]);
        }
      } else {
        payload[key] = payloadTemplate[key];
      }
    }
  }

  return payload;
};

const getStateResult = (rawInput, stateResult, resultPath) => {
  let input = { ...rawInput };

  if (resultPath !== null) {
    if (resultPath) {
      setValue(input, resultPath, stateResult);
    } else {
      input = stateResult;
    }
  }
  return input;
};

const wait = (seconds, timestamp, { options: { simulateWait } } = { options: {} }) => {
  if (simulateWait) {
    let duration;

    if (seconds) {
      duration = seconds * 1000;
    } else {
      duration = new Date(timestamp) - new Date();

      if (duration < 0) {
        return;
      }
    }

    return new Promise(resolve => setTimeout(resolve, duration));
  }
};

const evaluateJSONataString = (value, data) => {
  const isJSONataExpression = value.startsWith('{%') && value.endsWith('%}');

  if (!isJSONataExpression) {
    return value;
  }

  const expression = value.substring(2, value.length - 2).trim();

  return jsonata(expression).evaluate({}, data);
};

const evaluateJSONata = async (value, data) => {
  if (typeof value === 'string') {
    return evaluateJSONataString(value, data);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => evaluateJSONata(entry, data)));
  }

  if (typeof value === 'object' && value !== null) {
    const newValue = {};
    for (const key in value) {
      newValue[key] = await evaluateJSONata(value[key], data);
    }
    return newValue;
  }

  return value
};

const getJSONataInput = async (state, variables) => {
  if (state.Arguments) {
    return evaluateJSONata(state.Arguments, variables);
  } else {
    return variables.states.input;
  }
};

const getJSONataOutput = async (state, variables, defaultOutput = null) => {
  if (state.Output) {
    return evaluateJSONata(state.Output, variables);
  } else {
    return defaultOutput || variables.states.input;
  }
};

const assign = async (state, variables) => {
  if (state.Assign) {
    const assignment = await evaluateJSONata(state.Assign, variables);

    for (const variable in assignment) {
      if (variable === 'states') {
        continue;
      }

      variables[variable] = assignment[variable];
    }
  }
};

export {
  getTaskToken,
  getValue,
  setValue,
  applyPayloadTemplate,
  getStateResult,
  wait,
  evaluateJSONata,
  getJSONataInput,
  getJSONataOutput,
  assign,
};
