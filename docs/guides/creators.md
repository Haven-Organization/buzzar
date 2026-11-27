# Buzzar for Creators

![Screenshot of the Third Room Unity Exporter](/images/UnityExporter.jpg)

This guide is designed to help you understand how to create, export, and upload your 3D content for use in Buzzar worlds. With Buzzar, you have the opportunity to bring your artistic vision to life in a virtual environment that promotes collaboration and communication.

## Creating 3D Content

Buzzar supports the [glTF](https://www.khronos.org/gltf/) format for 3D content. This format is an open standard for transmitting 3D models and scenes. It is designed to be compact, efficient, and compatible with a wide variety of software and platforms.

There are two ways to make a world:

- **Any 3D tool, then glTF tools.** Export a scene from Blender (or download a model), then use Buzzar's command-line helpers to make it walkable, add seats, grabbable objects and lighting. See [Importing Worlds](/guides/importing-worlds).
- **Unity.** The [Third Room Unity exporter](/guides/unity/) still works with Buzzar. The Unity exporter lets you bake lightmaps, set spawn points, add physics to objects, and much more. You can also make content in other 3D software and import it into Unity to add the exporter's components like physics and spawn points.

Third Room started an in-engine editor, which Buzzar inherited; you can try it by pressing the `` ` `` key in a world you created. It isn't finished.

## Optimizing Your 3D Content

Buzzar worlds are designed to be lightweight, efficient, and work across a wide variety of devices. To ensure that your worlds load quickly and run smoothly, we recommend following these guidelines when creating your 3D content:

- Minimize draw calls by combining objects into a single mesh or using instancing where possible
- Reuse materials and textures where possible
- Bake lightmaps into your scene to reduce the number of lights and shadows that need to be rendered in real time
- Compress your textures using the asset pipeline or `optimize-world` (see [Importing Worlds](/guides/importing-worlds))
- Keep your texture resolutions to 2k or less
- Reduce your poly count, this is less important thant the other two but it's still a good idea to keep your poly count below 100k in most cases

The asset pipeline is built into Buzzar at `/pipeline` on your Buzzar site (for example `http://localhost:3000/pipeline`). Just drag and drop your .gltf, .bin, .png, .jpg, .mp3, etc files into the window and it will resize and compress textures as well as de-duplicate resources for you.

## Uploading

To use your 3D creations in Buzzar, you'll need to upload them to the platform. Follow these steps to upload your glTF files:

1. Log in to Buzzar and click the plus (+) sign at the top of the left panel and click "Create World" or edit an existing world's settings.
1. Select and upload the scene, script, and thumbnail image for the world. Your scene should be a binary glTF file or (.glb) ideally less than 50mb in size. Your script can either be a Javascript file or .wasm file (see the [developer guide for more info](/guides/developers)). Your thumbnail should be a square image in .jpg or .png format.
1. Click the "Create World" button to finalize the process and make your world available to other people.

## World Map

People press O in a world to see a map with a dot for everyone in it. To give your world a map picture:

1. Enter your world, open its settings and go to **Map**.
1. For an indoor world, turn on **Leave Out Everything Above a Height** and set it just under the ceiling, so the rooms show instead of the roof.
1. Click **Generate Map**. Buzzar draws the world from straight above on your computer (only the world itself: not people or spawned Items). Check the picture, then click **Save Map**.

Visitors only download the saved picture, so a map costs them nothing to draw. Generate it again whenever you change the world.

To use your own hand-drawn or stylised map instead, put it in the world file with [HAVEN_map](/gltf/HAVEN_map/README). A map in the file takes priority over a generated one.
