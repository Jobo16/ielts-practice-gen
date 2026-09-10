
(function (global) {
  'use strict';

  const definitions = new Map();

  function definitionKey(questionType, interactionVariant, layoutVariant) {
    return [questionType, interactionVariant, layoutVariant].map(String).join('|');
  }

  function register(definition) {
    if (!definition || typeof definition !== 'object') throw new TypeError('Question type definition must be an object.');
    const required = ['questionType', 'interactionVariant', 'layoutVariant', 'rendererId', 'responseMode'];
    required.forEach((field) => {
      if (!definition[field]) throw new Error(`Question type definition is missing ${field}.`);
    });
    const key = definitionKey(definition.questionType, definition.interactionVariant, definition.layoutVariant);
    if (definitions.has(key)) throw new Error(`Duplicate question type definition: ${key}`);
    const stored = Object.freeze({
      footerUnit: 'response',
      matchingMode: null,
      passageTargets: false,
      optionDisplay: 'label-and-text',
      ...definition,
      key,
    });
    definitions.set(key, stored);
    return stored;
  }

  function resolve(task) {
    if (!task) return null;
    return definitions.get(definitionKey(task.questionType, task.interactionVariant, task.layoutVariant)) || null;
  }

  function requireDefinition(task) {
    const definition = resolve(task);
    if (definition) return definition;
    throw new Error(`No runtime renderer is registered for ${definitionKey(
      task && task.questionType || '(missing)',
      task && task.interactionVariant || '(missing)',
      task && task.layoutVariant || '(missing)',
    )}.`);
  }

  function list() {
    return [...definitions.values()];
  }

  global.IELTSQuestionTypeRegistry = Object.freeze({
    definitionKey,
    register,
    resolve,
    require: requireDefinition,
    list,
  });
})(window);

    