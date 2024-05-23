import jp from 'jsonpath';

const getValue = (obj, path) => {
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

export {
  getValue,
  setValue,
};
