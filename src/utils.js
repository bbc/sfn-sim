import jp from 'jsonpath';
import { applyFunction } from './intrinsics';

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

const applyPayloadTemplate = (input, payloadTemplate) => {
  if (!payloadTemplate) {
    return input;
  }

  return getPayload(input, payloadTemplate);
};

const getPayload = (input, payloadTemplate) => {
  const payload = {};

  for (const key in payloadTemplate) {
    if (typeof payloadTemplate[key] === 'object') {
      payload[key] = getPayload(input, payloadTemplate[key]);
    } else {
      if (key.endsWith('.$')) {
        const payloadKey = key.replace('.$', '');

        if (payloadTemplate[key].startsWith('$')) {
          payload[payloadKey] = getValue(input, payloadTemplate[key]);
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

export {
  getValue,
  setValue,
  applyPayloadTemplate,
  getStateResult,
};
