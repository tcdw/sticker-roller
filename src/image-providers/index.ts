/**
 * 图片生成防腐层的跨端公共入口（阶段一）。
 *
 * Web / CLI / 服务端边界都从这里 import；服务端专属的 adapter、env 读取与配置状态
 * 属于后续阶段的 src/image-providers/server/，不会经过本文件，前端也不会打包到它们。
 */

export {
  type AiGatewayImageOptions,
  type AiGatewayModelId,
  type AiGatewaySelection,
  type GenerationSelection,
  type GoogleImageOptions,
  type GoogleModelId,
  type GoogleSelection,
  getModelDefinition,
  getProviderDefinition,
  IMAGE_PROVIDERS,
  type ImageProviderId,
  isImageProviderId,
  isLegacyProviderId,
  LEGACY_PROVIDER_IDS,
  type LegacyProviderId,
  listImageProviders,
} from './catalog';
export {
  type AnyModelDefinition,
  type AnyProviderDefinition,
  AUTO,
  BACKGROUND_STRATEGIES,
  type BackgroundStrategy,
  type BooleanField,
  type ModelDefinition,
  type NumberField,
  type OptionField,
  type OptionFieldGroup,
  type OptionFieldKind,
  type ProviderDefinition,
  type Result,
  SELECTION_VERSION,
  type SelectField,
  type SelectFieldChoice,
  type SelectionError,
  type SelectionErrorCode,
  type SelectionShape,
  type TextField,
} from './contracts';
export {
  type DecodedSelection,
  decodeLegacySnapshot,
  decodeSelectionSnapshot,
  decodeV2Snapshot,
  type LegacyDecodeContext,
  selectionsEqual,
  serializeSelection,
} from './decode';
export { defaultFieldValues, type OptionsMode, validateFieldValues } from './fields';
export { normalizeSelectionInput, type SelectionInput } from './normalize';
