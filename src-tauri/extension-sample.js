// Summarum extension example.
// Drop .js files into this folder and restart the app.
// API: numi.setVariable, numi.addUnit, numi.addFunction.

// A global variable usable on any sheet, e.g. `salary * vat`
// numi.setVariable("vat", { "double": 20 });

// A custom unit: 1 floor = 3 meters, so `5 floors in meters` works
// numi.addUnit({
//   "id": "floor",
//   "phrases": "floor, floors, этаж, этажа, этажей",
//   "baseUnitId": "meter",
//   "format": "fl",
//   "ratio": 3,
// });

// A custom function: hyp(3; 4) -> 5
// numi.addFunction({ "id": "hyp", "phrases": "hyp" }, function (values) {
//   return { "double": Math.hypot(values[0].double, values[1].double) };
// });
