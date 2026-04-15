import { Context, Layer } from "effect";
import type { RegistryStoreLike } from "./registry-store-model.js";

export class RegistryStoreService extends Context.Tag("aie-matrix/RegistryStoreService")<
  RegistryStoreService,
  RegistryStoreLike
>() {}

export const makeRegistryStoreLayer = (store: RegistryStoreLike): Layer.Layer<RegistryStoreService> =>
  Layer.succeed(RegistryStoreService, store);
