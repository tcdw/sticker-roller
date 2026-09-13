import { type GenerationSelection, getModelDefinition, getProviderDefinition } from './catalog';
import { validateFieldValues } from './fields';
import { normalizeSelectionInput } from './normalize';

/** Channel changes reset; model changes retain only values accepted by the target definition. */
export function switchSelection(current: GenerationSelection, providerId: string, modelId?: string) {
  const targetId = modelId ?? getProviderDefinition(providerId)?.models[0]?.id;
  const model = targetId ? getModelDefinition(providerId, targetId) : undefined;
  if (!model) {
    throw new Error('unknown target model');
  }
  const options: Record<string, unknown> = {};
  const cleared: string[] = [];
  const sameProvider = current.providerId === providerId;
  for (const [name, value] of Object.entries(current.options)) {
    const field = model.fields.find((candidate) => candidate.name === name);
    if (sameProvider && field && validateFieldValues([field], { [name]: value }, 'snapshot').ok) {
      options[name] = value;
    } else {
      cleared.push(name);
    }
  }
  const background =
    sameProvider && model.backgrounds.includes(current.background) ? current.background : model.defaultBackground;
  if (background !== current.background) {
    cleared.push('background');
  }
  const result = normalizeSelectionInput({ providerId, modelId: targetId, options, background });
  if (!result.ok) {
    throw new Error('invalid target selection');
  }
  return { selection: result.value, cleared };
}
