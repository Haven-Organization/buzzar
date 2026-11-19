# Rebuilding the default Home World

`compose-home.mjs` uses glTF-Transform v4, which is newer than the version in this repo's dependencies, so run
it from a scratch folder:

```sh
mkdir /tmp/home-build && cd /tmp/home-build
npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4
cp <repo>/scripts/buzzar/home/compose-home.mjs .
# Kenney Nature Kit: https://kenney.nl/assets/nature-kit (unzip; use "Models/GLTF format")
# Poly Haven: grass_ground + cobblestone_floor_01 diffuse (1k jpg, resized to 512), sky kloofendal_48d_partly_cloudy_puresky 1k hdr
node compose-home.mjs "<kenney>/Models/GLTF format" grass.jpg paving.jpg composed.glb
node <repo>/scripts/buzzar/finish-world.mjs composed.glb --out <repo>/public/worlds/home/home.glb \
  --ground 0 --center 0,0 --spawn 0,-3.6,180 --name "Buzzar Home" --sky sky_1k.hdr
```

Then bump `home.version` in `res/defaultWorlds.json` so existing Home Worlds pick up the new scene.
