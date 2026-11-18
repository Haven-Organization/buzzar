// World script for the Buzzar test room (Buzzar Mirror Test on Matrix): spins the yellow pillar, so it's obvious at a
// glance whether the world's script is running. Upload it as the world's script (World Settings > Change Script).
let pillar;

// Nodes can only be found once the scene has loaded.
world.onload = () => {
  pillar = world.findNodeByName("Pillar3");
  console.log(pillar ? "test room script: spinning Pillar3" : "test room script: Pillar3 not found");
};

world.onupdate = (dt, time) => {
  if (!pillar) return;
  const half = (time * 1.5) / 2;
  pillar.rotation.x = 0;
  pillar.rotation.y = Math.sin(half);
  pillar.rotation.z = 0;
  pillar.rotation.w = Math.cos(half);
};
