// World script for the Buzzar test room (Buzzar Mirror Test on Matrix): spins the yellow pillar, so it's obvious at a
// glance whether the world's script is running. Upload it as the world's script (World Settings > Change Script).
const pillar = world.findNodeByName("Pillar3");

world.onupdate = (dt, time) => {
  if (!pillar) return;
  const angle = time * 1.5;
  pillar.rotation.x = 0;
  pillar.rotation.y = Math.sin(angle / 2);
  pillar.rotation.z = 0;
  pillar.rotation.w = Math.cos(angle / 2);
};
