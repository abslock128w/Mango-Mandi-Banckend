// Stand-in set for a chapter whose set failed to build: a lit mango on a warm gradient, so no frame is ever blank.
import * as THREE from 'three'
import { Stage, aim, skyDome } from './stage.js'
import { Mango } from '../lib/mango.js'

export default class Placeholder extends Stage {
  constructor(engine) {
    super(engine)
    this.sky = skyDome(); this.scene.add(this.sky)
    this.mango = new Mango({ ripe: 0.6 }); this.scene.add(this.mango)
    this.scene.add(new THREE.HemisphereLight('#fff2d8', '#2a3a22', 1.2))
    const d = new THREE.DirectionalLight('#ffe2b0', 3); d.position.set(3, 4, 2); this.scene.add(d)
    this.scene.environment = engine.env()
  }
  update(i, t, time) {
    aim(this.camera, new THREE.Vector3(Math.sin(t) * 5, 0.5, Math.cos(t) * 5), new THREE.Vector3())
    this.mango.tick(time, this.sunView, this.sunCol)
    this.focus.set(0, 0, 0)
  }
}
