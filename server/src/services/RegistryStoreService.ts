import type { RegistryStore } from "@aie-matrix/server-registry";
import { Context, Layer } from "effect";

export class RegistryStoreService extends Context.Tag("aie-matrix/RegistryStoreService")<
  RegistryStoreService,
  RegistryStore
>() {}

export const makeRegistryStoreLayer = (store: RegistryStore): Layer.Layer<RegistryStoreService> =>
  Layer.succeed(RegistryStoreService, store);
