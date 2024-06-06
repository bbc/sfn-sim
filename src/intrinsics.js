import { IntrinsicFailureError } from './errors';
import { getValue } from './utils';

const applyFunction = (input, functionString) => {
  if (functionString.startsWith('States.StringToJson')) {
    const path = functionString.replace('States.StringToJson(', '').slice(0, -1);
    return JSON.parse(getValue(input, path));
  }

  if (functionString.startsWith('States.JsonToString')) {
    const path = functionString.replace('States.JsonToString(', '').slice(0, -1);
    return JSON.stringify(getValue(input, path));
  }

  if (functionString.startsWith('States.Array')) {
    return functionString
      .replace('States.Array(', '')
      .slice(0, -1)
      .split(',')
      .map((element) => {
        const path = element.trim(); // TODO handle other types
        return getValue(input, path);
      });
  }

  throw new IntrinsicFailureError();
};

export {
  applyFunction,
};
