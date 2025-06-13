import jp from 'jsonpath';
import jsonata from 'jsonata';
import { applyFunction } from './intrinsics.js';

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

        if (payloadTemplate[key].startsWith('$.')) {
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

const wait = (seconds, { options: { simulateWait } }) => {
  if (simulateWait) {
    const duration = seconds * 1000;
    return new Promise(resolve => setTimeout(resolve, duration));
  }
};

const evaluateJSONataString = (value, data) => {
  const isJSONataExpression = value.startsWith('{%') && value.endsWith('%}');

  if (!isJSONataExpression) {
    return value;
  }

  const expression = jsonata(value.substring(2, value.length - 2).trim());
  return expression.evaluate(data);
};

const evaluateJSONata = async (value, data) => {
  if (typeof value === 'string') {
    return evaluateJSONataString(value, data);
  }

  for (const key in value) {
    value[key] = await evaluateJSONata(value[key], data);
  }

  return value;
};

export {
  getValue,
  setValue,
  applyPayloadTemplate,
  getStateResult,
  wait,
  evaluateJSONata,
};
