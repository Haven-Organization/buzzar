/**
 * Buzzar: decompress glTF files before loading, so worlds and avatars can ship compressed.
 *
 * The loader builds resources synchronously from plain buffers, so compressed data is unpacked first, right after the
 * buffers are downloaded, into ordinary buffer views and accessors:
 *
 * - EXT_meshopt_compression / KHR_meshopt_compression: compressed buffer views (geometry, animation) are decoded
 *   with meshoptimizer's decoder into a new buffer and the views are pointed at it. Their fallback buffers, which have
 *   no data, are allowed.
 * - KHR_draco_mesh_compression: each compressed primitive is decoded with Draco (loaded only when a file uses it) and
 *   its accessors are pointed at the decoded data.
 *
 * KHR_mesh_quantization (integer positions and normals, usually paired with meshopt) needs no unpacking: accessors
 * carry their component type and `normalized` flag to the renderer, and colliders read positions through
 * getAccessorFloat32Array. EXT_texture_webp is chosen in the texture loader; browsers decode WebP natively.
 */
import { MeshoptDecoder } from "meshoptimizer";
import dracoWrapperSource from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?raw";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

import { GLTFRoot } from "./GLTF";

/** Extensions this loader understands (anything else that a file requires gets a console warning). */
export const SUPPORTED_REQUIRED_EXTENSIONS = new Set([
  "EXT_meshopt_compression",
  "KHR_meshopt_compression",
  "KHR_draco_mesh_compression",
  "KHR_mesh_quantization",
  "EXT_texture_webp",
  "KHR_texture_basisu",
  "KHR_texture_transform",
  "KHR_materials_unlit",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_transmission",
  "KHR_materials_volume",
  "KHR_materials_clearcoat",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_iridescence",
  "MOZ_lightmap",
  "KHR_lights_shadows",
  "KHR_lights_punctual",
  "EXT_mesh_gpu_instancing",
]);

interface MeshoptExtension {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
  filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL";
}

interface DracoExtension {
  bufferView: number;
  attributes: Record<string, number>;
}

/** Whether a buffer only exists as the uncompressed stand-in for meshopt-compressed views (it has no data). */
export function isMeshoptFallbackBuffer(buffer: { extensions?: Record<string, unknown> }) {
  const ext = (buffer.extensions?.EXT_meshopt_compression ?? buffer.extensions?.KHR_meshopt_compression) as
    | { fallback?: boolean }
    | undefined;
  return !!ext?.fallback;
}

/** Appends `chunks` as one new buffer and returns its index and each chunk's byte offset in it. */
function appendBuffer(root: GLTFRoot, buffers: Map<number, SharedArrayBuffer>, chunks: Uint8Array[]) {
  const offsets: number[] = [];
  let length = 0;
  for (const chunk of chunks) {
    offsets.push(length);
    length += Math.ceil(chunk.byteLength / 4) * 4;
  }
  const data = new SharedArrayBuffer(length);
  const bytes = new Uint8Array(data);
  chunks.forEach((chunk, i) => bytes.set(chunk, offsets[i]));
  root.buffers ??= [];
  const index = root.buffers.length;
  root.buffers.push({ byteLength: length });
  buffers.set(index, data);
  return { index, offsets };
}

async function decodeMeshopt(root: GLTFRoot, buffers: Map<number, SharedArrayBuffer>) {
  const views = (root.bufferViews ?? []).filter(
    (view) => view.extensions?.EXT_meshopt_compression || view.extensions?.KHR_meshopt_compression
  );
  if (views.length === 0) return;
  await MeshoptDecoder.ready;

  const chunks = views.map((view) => {
    const ext = (view.extensions!.EXT_meshopt_compression ??
      view.extensions!.KHR_meshopt_compression) as MeshoptExtension;
    const data = buffers.get(ext.buffer);
    if (!data) throw new Error(`meshopt: buffer ${ext.buffer} is missing`);
    const source = new Uint8Array(data, ext.byteOffset ?? 0, ext.byteLength);
    const target = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, source, ext.mode, ext.filter ?? "NONE");
    return target;
  });

  const { index, offsets } = appendBuffer(root, buffers, chunks);
  views.forEach((view, i) => {
    view.buffer = index;
    view.byteOffset = offsets[i];
    view.byteLength = chunks[i].byteLength;
    delete view.extensions!.EXT_meshopt_compression;
    delete view.extensions!.KHR_meshopt_compression;
  });
}

// --- Draco ----------------------------------------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DracoModule = any;
let dracoModule: Promise<{ draco: DracoModule }> | undefined;

/**
 * Loads Draco once. The decoder is a classic script (it sets DracoDecoderModule), so it is evaluated here.
 * The module is returned wrapped in an object: Emscripten modules have their own `then`, and resolving a promise with
 * one directly makes the promise call it forever, freezing the thread.
 */
function loadDraco(): Promise<{ draco: DracoModule }> {
  dracoModule ??= (async () => {
    const wasmBinary = await (await fetch(dracoWasmUrl)).arrayBuffer();
    // eslint-disable-next-line no-new-func
    const factory = new Function("module", "exports", `${dracoWrapperSource}\nreturn DracoDecoderModule;`)(
      undefined,
      undefined
    );
    return new Promise<{ draco: DracoModule }>((resolve) =>
      factory({ wasmBinary, onModuleLoaded: (draco: DracoModule) => resolve({ draco }) })
    );
  })();
  return dracoModule;
}

const COMPONENT_ARRAYS: Record<number, Int8ArrayConstructor | Uint8ArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
}; // prettier-ignore

function dracoDataType(draco: DracoModule, componentType: number) {
  switch (componentType) {
    case 5120:
      return draco.DT_INT8;
    case 5121:
      return draco.DT_UINT8;
    case 5122:
      return draco.DT_INT16;
    case 5123:
      return draco.DT_UINT16;
    case 5125:
      return draco.DT_UINT32;
    default:
      return draco.DT_FLOAT32;
  }
}

async function decodeDraco(root: GLTFRoot, buffers: Map<number, SharedArrayBuffer>) {
  const primitives = (root.meshes ?? [])
    .flatMap((mesh) => mesh.primitives)
    .filter((primitive) => primitive.extensions?.KHR_draco_mesh_compression);
  if (primitives.length === 0) return;
  const { draco } = await loadDraco();

  const chunks: Uint8Array[] = [];
  const pending: { accessor: number; chunk: number }[] = [];

  for (const primitive of primitives) {
    const ext = primitive.extensions!.KHR_draco_mesh_compression as DracoExtension;
    const view = root.bufferViews?.[ext.bufferView];
    const data = view && buffers.get(view.buffer);
    if (!view || !data) throw new Error(`Draco: buffer view ${ext.bufferView} is missing`);

    const decoder = new draco.Decoder();
    const input = new draco.DecoderBuffer();
    input.Init(new Int8Array(data, view.byteOffset ?? 0, view.byteLength), view.byteLength);
    const mesh = new draco.Mesh();
    try {
      if (decoder.GetEncodedGeometryType(input) !== draco.TRIANGULAR_MESH) {
        throw new Error("Draco: only triangle meshes are supported");
      }
      const status = decoder.DecodeBufferToMesh(input, mesh);
      if (!status.ok() || mesh.ptr === 0) throw new Error(`Draco: decoding failed: ${status.error_msg()}`);

      // Attributes, in each accessor's own component type (quantized files keep their integers).
      for (const [semantic, uniqueId] of Object.entries(ext.attributes)) {
        const accessorIndex = primitive.attributes[semantic];
        const accessor = accessorIndex !== undefined ? root.accessors?.[accessorIndex] : undefined;
        if (!accessor) continue;
        const attribute = decoder.GetAttributeByUniqueId(mesh, uniqueId);
        const ArrayType = COMPONENT_ARRAYS[accessor.componentType] ?? Float32Array;
        const values = mesh.num_points() * attribute.num_components();
        const byteLength = values * ArrayType.BYTES_PER_ELEMENT;
        const ptr = draco._malloc(byteLength);
        decoder.GetAttributeDataArrayForAllPoints(
          mesh,
          attribute,
          dracoDataType(draco, accessor.componentType),
          byteLength,
          ptr
        );
        const array = new ArrayType(draco.HEAPF32.buffer, ptr, values).slice();
        draco._free(ptr);
        pending.push({ accessor: accessorIndex, chunk: chunks.length });
        chunks.push(new Uint8Array(array.buffer));
      }

      // Indices, as 32-bit.
      if (primitive.indices !== undefined && root.accessors?.[primitive.indices]) {
        const count = mesh.num_faces() * 3;
        const ptr = draco._malloc(count * 4);
        decoder.GetTrianglesUInt32Array(mesh, count * 4, ptr);
        const indices = new Uint32Array(draco.HEAPF32.buffer, ptr, count).slice();
        draco._free(ptr);
        const accessor = root.accessors[primitive.indices];
        accessor.componentType = 5125;
        accessor.count = count;
        pending.push({ accessor: primitive.indices, chunk: chunks.length });
        chunks.push(new Uint8Array(indices.buffer));
      }
    } finally {
      draco.destroy(mesh);
      draco.destroy(input);
      draco.destroy(decoder);
    }
    delete primitive.extensions!.KHR_draco_mesh_compression;
  }

  const { index, offsets } = appendBuffer(root, buffers, chunks);
  root.bufferViews ??= [];
  for (const { accessor, chunk } of pending) {
    const viewIndex = root.bufferViews.length;
    root.bufferViews.push({ buffer: index, byteOffset: offsets[chunk], byteLength: chunks[chunk].byteLength });
    const def = root.accessors![accessor];
    def.bufferView = viewIndex;
    def.byteOffset = 0;
  }
}

/** Unpacks every compressed part of a loaded glTF in place (see the file comment). */
export async function decompressGLTF(root: GLTFRoot, buffers: Map<number, SharedArrayBuffer>) {
  const unsupported = (root.extensionsRequired ?? []).filter((name) => !SUPPORTED_REQUIRED_EXTENSIONS.has(name));
  if (unsupported.length > 0) {
    console.warn(
      `This 3D file requires extensions Buzzar doesn't support (it may look wrong): ${unsupported.join(", ")}`
    );
  }
  await decodeMeshopt(root, buffers);
  await decodeDraco(root, buffers);
}
