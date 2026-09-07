// Overlapping appointments in one staff column share the width: each gets the
// first lane whose previous block has already ended.
export const withLanes = (items) => {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const laneEnds = [];
  const laid = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.top);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.top + item.height;
    return { ...item, lane };
  });
  const lanes = Math.max(laneEnds.length, 1);
  return laid.map((item) => ({ ...item, lanes }));
};
