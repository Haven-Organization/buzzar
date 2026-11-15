---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: Buzzar
  text: Documentation
  tagline: Shared virtual worlds on Matrix. Open source, decentralized, and compatible with Third Room worlds.
  image:
    src: /icon.svg
    alt: Buzzar
  actions:
    - theme: brand
      text: Get Started
      link: /guides/
    - theme: alt
      text: Build a World
      link: /guides/importing-worlds
    - theme: alt
      text: View on GitHub
      link: https://github.com/Haven-Organization/buzzar

features:
  - icon: 🌍
    title: Make worlds from any 3D model
    details: Turn Blender scenes and downloaded models into walkable worlds with seats, things to pick up and mirrors.
    link: /guides/importing-worlds
  - icon: 🧑‍🎤
    title: Bring your own avatar
    details: Wear a VRM or glTF avatar in every world, or a different one per world.
    link: /guides/avatars
  - icon: 🎨
    title: Creator Guide
    details: Build worlds in Unity with the Third Room exporter, which Buzzar still supports.
    link: /guides/creators
  - icon: 👩‍💻
    title: Developer Guide
    details: Script worlds with the Web Scene Graph API, in JavaScript or any language that compiles to WebAssembly.
    link: /guides/developers
  - icon: 🧩
    title: glTF Extensions
    details: The scene format, including Buzzar's HAVEN_* extensions for seats, grabbables, mirrors and avatar pedestals.
    link: /gltf/
  - icon: 📚
    title: Web Scene Graph Reference
    details: The Web Scene Graph JavaScript API reference.
    link: /websg-js/
---
