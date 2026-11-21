// @ts-check
// Massive bodies in the simulation.
//
// `el` / `rate` are JPL's approximate Keplerian elements (Standish, valid
// 1800–2050), flattened to 2D:  [a (AU), e, L mean longitude (°), ϖ longitude
// of perihelion (°)], with rates per Julian century. Inclination and node are
// dropped because the simulation is planar.
// Source: https://ssd.jpl.nasa.gov/planets/approx_pos.html
/** @type {import("./types").BodySpec[]} */
export const BODY_DATA = [
  { name: "Sun", radiusKm: 696340, mass: 1.0, color: "#FDB813", displayRadius: 12, isSun: true },
  {
    name: "Mercury", radiusKm: 2440, mass: 1.652e-7, color: "#9E9590", displayRadius: 3,
    el: [0.38709927, 0.20563593, 252.2503235, 77.45779628],
    rate: [0.00000037, 0.00001906, 149472.67411175, 0.16047689],
  },
  {
    name: "Venus", radiusKm: 6052, mass: 2.447e-6, color: "#E8CDA0", displayRadius: 4.5,
    el: [0.72333566, 0.00677672, 181.9790995, 131.60246718],
    rate: [0.0000039, -0.00004107, 58517.81538729, 0.00268329],
  },
  {
    name: "Earth", radiusKm: 6371, mass: 3.003e-6, color: "#4B8FE5", displayRadius: 4.8,
    el: [1.00000261, 0.01671123, 100.46457166, 102.93768193],
    rate: [0.00000562, -0.00004392, 35999.37244981, 0.32327364],
  },
  {
    name: "Mars", radiusKm: 3390, mass: 3.213e-7, color: "#C1440E", displayRadius: 3.5,
    el: [1.52371034, 0.0933941, -4.55343205, -23.94362959],
    rate: [0.00001847, 0.00007882, 19140.30268499, 0.44441088],
  },
  {
    name: "Jupiter", radiusKm: 69911, mass: 9.543e-4, color: "#C88B3A", displayRadius: 9,
    el: [5.202887, 0.04838624, 34.39644051, 14.72847983],
    rate: [-0.00011607, -0.00013253, 3034.74612775, 0.21252668],
  },
  {
    name: "Saturn", radiusKm: 58232, mass: 2.857e-4, color: "#E3D5A0", displayRadius: 8, rings: true,
    el: [9.53667594, 0.05386179, 49.95424423, 92.59887831],
    rate: [-0.0012506, -0.00050991, 1222.49362201, -0.41897216],
  },
  {
    name: "Uranus", radiusKm: 25362, mass: 4.365e-5, color: "#7EC8E3", displayRadius: 6,
    el: [19.18916464, 0.04725744, 313.23810451, 170.9542763],
    rate: [-0.00196176, -0.00004397, 428.48202785, 0.40805281],
  },
  {
    name: "Neptune", radiusKm: 24622, mass: 5.149e-5, color: "#4B5FE8", displayRadius: 5.8,
    el: [30.06992276, 0.00859048, -55.12002969, 44.96476227],
    rate: [0.00026291, 0.00005105, 218.45945325, -0.32241464],
  },
  {
    name: "Pluto", radiusKm: 1188, mass: 6.55e-9, color: "#C9B39A", displayRadius: 2.4, isDwarf: true,
    el: [39.48211675, 0.2488273, 238.92903833, 224.06891629],
    rate: [-0.00031596, 0.0000517, 145.20780515, -0.04062942],
  },
];
