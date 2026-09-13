import {
  type GenerationSelection,
  getModelDefinition,
  getProviderDefinition,
  IMAGE_PROVIDERS,
} from '../../../src/image-providers/catalog';
import { normalizeSelectionInput } from '../../../src/image-providers/normalize';
import { switchSelection } from '../../../src/image-providers/switch';
import type { Options } from '../api';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function ProviderOptionsFields({
  options,
  onChange,
  onNotice,
}: {
  options: Options;
  onChange: (value: Options) => void;
  onNotice: (value: string) => void;
}) {
  const selection = options.selection;
  const provider = getProviderDefinition(selection.providerId);
  const model = getModelDefinition(selection.providerId, selection.modelId);
  function update(value: Parameters<typeof normalizeSelectionInput>[0]) {
    const parsed = normalizeSelectionInput(value);
    if (!parsed.ok) {
      onNotice(`参数无效：${parsed.error.code}`);
      return;
    }
    onChange({ ...options, selection: parsed.value });
  }
  function changeChannel(providerId: string, modelId?: string) {
    const next = switchSelection(selection, providerId, modelId);
    onChange({ ...options, selection: next.selection });
    onNotice(
      next.cleared.length
        ? `已清理不兼容或跨渠道参数：${next.cleared.join('、')}；提示词、引用和张数保留`
        : '已切换模型，兼容参数、背景和张数保留',
    );
  }
  function field(name: string, value: unknown) {
    const next = { ...selection.options } as Record<string, unknown>;
    if (value === 'auto') {
      delete next[name];
    } else {
      next[name] = value;
    }
    update({ ...selection, options: next });
  }
  const choices = (
    label: string,
    value: string,
    items: readonly { value: string; label: string }[],
    change: (value: string) => void,
  ) => (
    <Select value={value} onValueChange={change}>
      <SelectTrigger className="w-full sm:w-48" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <>
      {choices(
        'API 渠道',
        selection.providerId,
        IMAGE_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
        (id) => changeChannel(id),
      )}
      {choices(
        '生成模型',
        selection.modelId,
        provider?.models.map((m) => ({ value: m.id, label: m.label })) ?? [],
        (id) => changeChannel(selection.providerId, id),
      )}
      {model?.fields.map((definition) => {
        const value = (selection.options as Record<string, unknown>)[definition.name];
        return (
          <div key={definition.name}>
            {definition.kind === 'select' ? (
              choices(
                definition.label,
                String(value ?? 'auto'),
                [
                  ...(definition.optional ? [{ value: 'auto', label: `${definition.label}：自动` }] : []),
                  ...definition.choices,
                ],
                (next) => field(definition.name, next),
              )
            ) : definition.kind === 'boolean' ? (
              <label htmlFor={`provider-option-${definition.name}`}>
                <Checkbox
                  id={`provider-option-${definition.name}`}
                  checked={value === true}
                  onCheckedChange={(next) => field(definition.name, next === true)}
                />
                {definition.label}
              </label>
            ) : (
              <Input
                aria-label={definition.label}
                type={definition.kind === 'number' ? 'number' : 'text'}
                value={String(value ?? '')}
                onChange={(event) =>
                  field(definition.name, definition.kind === 'number' ? Number(event.target.value) : event.target.value)
                }
              />
            )}
          </div>
        );
      })}
      {choices(
        '背景处理',
        selection.background,
        model?.backgrounds.map((value) => ({
          value,
          label: value === 'original' ? '原背景（不透明）' : value === 'magenta-key' ? '洋红背景抠底' : '原生透明背景',
        })) ?? [],
        (background) => update({ ...selection, background } as GenerationSelection),
      )}
    </>
  );
}
