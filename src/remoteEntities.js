import * as THREE from "three";
import { Kind, PlayerStatus } from "./shared/sim/entities.js";
export function createRemoteEntities(scene) {
  const players = new Map();
  const geometry = new THREE.CapsuleGeometry(0.32, 1.05, 4, 12);
  function remove(id) {
    const p = players.get(id);
    scene.remove(p.group);
    p.material.dispose();
    p.label.material.map.dispose();
    p.label.material.dispose();
    players.delete(id);
  }
  return {
    update(entities, self, camera) {
      const visible = new Set();
      for (const entity of entities.values()) {
        if (entity.kind !== Kind.PLAYER || entity.id === self?.entity) continue;
        visible.add(entity.id);
        let p = players.get(entity.id);
        if (!p) {
          const group = new THREE.Group(),
            material = new THREE.MeshStandardMaterial({
              color: new THREE.Color().setHSL(
                (entity.id * 0.19) % 1,
                0.35,
                0.65,
              ),
            });
          const body = new THREE.Mesh(geometry, material);
          body.position.y = 0.85;
          body.castShadow = true;
          group.add(body);
          const canvas = document.createElement("canvas");
          canvas.width = 512;
          canvas.height = 80;
          const ctx = canvas.getContext("2d");
          ctx.font = "32px sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = "#f3efdb";
          ctx.fillText(entity.fields.name, 256, 48);
          const texture = new THREE.CanvasTexture(canvas),
            label = new THREE.Sprite(
              new THREE.SpriteMaterial({ map: texture, depthTest: false }),
            );
          label.position.y = 2.05;
          label.scale.set(2, 0.3125, 1);
          group.add(label);
          scene.add(group);
          p = { group, material, label };
          players.set(entity.id, p);
        }
        p.group.position.set(entity.fields.x, 0, entity.fields.z);
        p.group.rotation.y = entity.fields.yaw;
        p.group.visible = entity.fields.lvl === 0;
        p.material.transparent = true;
        p.material.opacity = [
          PlayerStatus.CAPTURED,
          PlayerStatus.DISCONNECTED,
        ].includes(entity.fields.st)
          ? 0.35
          : 1;
        // Fade nearby labels so they don't obscure the view when passing another player.
        p.label.material.opacity = Math.min(
          1,
          p.group.position.distanceTo(camera.position) / 1.5,
        );
      }
      for (const id of players.keys()) if (!visible.has(id)) remove(id);
    },
    clear() {
      for (const id of [...players.keys()]) remove(id);
    },
    dispose() {
      this.clear();
      geometry.dispose();
    },
  };
}
