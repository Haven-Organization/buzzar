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
# High / Low / Off buttons beside the mirror (and the mirror surface itself not pressable):
python3 <repo>/scripts/buzzar/home/add-mirror-buttons.py <repo>/public/worlds/home/home.glb
```

Then set its details with `scripts/buzzar/bake-gltf.ts` (name, description, author, and the next `--version`).

Then give it its map picture (`HAVEN_map`, shown when you press O). In Home World, run
`await thirdroom.generateWorldMap()` in the console. It returns the picture's `url` and the `area` it covers. Shrink the
picture to 1024 px webp (about 90 KB), then:

```sh
node_modules/.bin/vite-node scripts/buzzar/bake-gltf.ts -- home.glb public/worlds/home/home.glb \
  --map home-map.webp --map-min -41.6,-41.6 --map-max 41.6,41.6
```

Then bump `home.version` in `res/defaultWorlds.json` so existing Home Worlds pick up the new scene.
