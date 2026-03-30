const demoRelations = [
  {
    id_владельца: "PARENT_A",
    id_организации: "ORG_1",
    level_организации: 1,
    доля_владения: "65%",
    tags: ["critical"]
  },
  {
    id_владельца: "PARENT_A",
    id_организации: "ORG_2",
    level_организации: 1,
    доля_владения: "35%",
    flags: { foreign: true }
  },
  {
    id_владельца: "ORG_1",
    id_организации: "ORG_3",
    level_организации: 2,
    доля_владения: "51%",
    tags: ["foreign"]
  },
  {
    id_владельца: "ORG_1",
    id_организации: "ORG_4",
    level_организации: 2,
    доля_владения: "49%"
  },
  {
    id_владельца: "ORG_2",
    id_организации: "ORG_5",
    level_организации: 2,
    доля_владения: "100%",
    tags: ["critical"]
  },
  {
    id_владельца: "ORG_5",
    id_организации: "ORG_6",
    level_организации: 3,
    доля_владения: "25%"
  }
];

const demoTagStyles = {
  critical: {
    fill: "#ffe4e8",
    stroke: "#cc2f47",
    strokeWidth: 2
  },
  foreign: {
    fill: "#e8f5ff",
    stroke: "#247ea6",
    strokeWidth: 2
  }
};

const spacing = {
  nodeWidth: 180,
  nodeHeight: 60,
  marginX: 36,
  marginY: 24,
  levelGap: 230,
  rowGap: 92,
  edgeLaneGap: 20,
  routeOffset: 14
};

class OwnershipGraph {
  constructor(containerSelector) {
    this.container = d3.select(containerSelector);
    this.tagStyles = {};
    this.palette = d3.schemeTableau10;
    this.ownerColor = new Map();
  }

  setTagStyles(tagStyles) {
    this.tagStyles = tagStyles || {};
  }

  render(rawRows) {
    const rows = this.normalizeRows(rawRows);
    const model = this.buildModel(rows);
    const layout = this.computeLayout(model);
    this.draw(layout);
  }

  normalizeRows(rawRows) {
    const valueOr = (obj, keys, fallback = null) => {
      for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null) {
          return obj[key];
        }
      }
      return fallback;
    };

    return rawRows.map((row, idx) => {
      const ownerId = String(valueOr(row, ["owner_id", "id_владельца", "ownerId"]));
      const organizationId = String(
        valueOr(row, ["organization_id", "id_организации", "organizationId"])
      );
      const level = Number(
        valueOr(row, ["organization_level", "level_организации", "level"], 0)
      );
      const share = String(valueOr(row, ["share", "доля_владения"], ""));
      const flags = valueOr(row, ["flags", "характеристики", "characteristics"], {});
      const tags = valueOr(row, ["tags", "метки"], []);

      if (!ownerId || !organizationId || Number.isNaN(level)) {
        throw new Error(
          `Некорректная запись #${idx + 1}. Ожидаются owner/organization/level.`
        );
      }

      return {
        ownerId,
        organizationId,
        level,
        share,
        flags: this.normalizeFlags(flags),
        tags: Array.isArray(tags) ? tags.map(String) : []
      };
    });
  }

  normalizeFlags(flags) {
    if (!flags) {
      return {};
    }
    if (Array.isArray(flags)) {
      return Object.fromEntries(flags.map((name) => [String(name), true]));
    }
    if (typeof flags === "object") {
      return flags;
    }
    return {};
  }

  buildModel(rows) {
    const nodeById = new Map();
    const incomingByChild = new Map();
    const outgoingByParent = new Map();
    const links = [];

    const ensureNode = (id) => {
      if (!nodeById.has(id)) {
        nodeById.set(id, {
          id,
          level: 0,
          incoming: [],
          outgoing: [],
          tags: new Set(),
          flags: {}
        });
      }
      return nodeById.get(id);
    };

    rows.forEach((row, index) => {
      const parentNode = ensureNode(row.ownerId);
      const childNode = ensureNode(row.organizationId);
      childNode.level = Math.max(childNode.level, row.level);

      row.tags.forEach((tag) => childNode.tags.add(tag));
      childNode.flags = { ...childNode.flags, ...row.flags };

      const link = {
        id: `link-${index}`,
        source: row.ownerId,
        target: row.organizationId,
        share: row.share,
        level: row.level
      };
      links.push(link);

      parentNode.outgoing.push(link);
      childNode.incoming.push(link);

      if (!outgoingByParent.has(row.ownerId)) {
        outgoingByParent.set(row.ownerId, []);
      }
      outgoingByParent.get(row.ownerId).push(link);

      if (!incomingByChild.has(row.organizationId)) {
        incomingByChild.set(row.organizationId, []);
      }
      incomingByChild.get(row.organizationId).push(link);
    });

    const nodes = Array.from(nodeById.values());

    this.resolveRootLevels(nodes);
    this.ownerColor = this.computeOwnerColors(outgoingByParent);

    return { nodes, links, outgoingByParent, incomingByChild };
  }

  resolveRootLevels(nodes) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const queue = nodes.filter((node) => node.incoming.length === 0);
    const seen = new Set(queue.map((node) => node.id));

    queue.forEach((node) => {
      if (node.level > 0) {
        return;
      }
      if (node.outgoing.length === 0) {
        node.level = 0;
      } else {
        const minOutLevel = Math.min(...node.outgoing.map((link) => link.level));
        node.level = Math.max(0, minOutLevel - 1);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift();
      current.outgoing.forEach((link) => {
        const child = nodeById.get(link.target);
        if (!child) {
          return;
        }
        const nextLevel = Math.max(child.level, current.level + 1);
        child.level = nextLevel;
        if (!seen.has(child.id)) {
          queue.push(child);
          seen.add(child.id);
        }
      });
    }
  }

  computeOwnerColors(outgoingByParent) {
    const entries = Array.from(outgoingByParent.keys()).sort();
    const colorMap = new Map();
    entries.forEach((ownerId, index) => {
      colorMap.set(ownerId, this.palette[index % this.palette.length]);
    });
    return colorMap;
  }

  computeLayout(model) {
    const levels = d3.group(model.nodes, (node) => node.level);
    const sortedLevels = Array.from(levels.keys()).sort((a, b) => a - b);
    const levelIndex = new Map(sortedLevels.map((lv, i) => [lv, i]));

    const nodes = model.nodes.map((node) => ({ ...node, tags: Array.from(node.tags) }));

    nodes.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return a.id.localeCompare(b.id);
    });

    const maxRows = d3.max(sortedLevels, (lv) => (levels.get(lv) || []).length) || 1;
    const maxLevelIndex = Math.max(0, sortedLevels.length - 1);
    const rightMostNodeX = spacing.marginX + maxLevelIndex * spacing.levelGap + spacing.nodeWidth;
    const ownerLaneX = this.computeOwnerLaneX(model.outgoingByParent, rightMostNodeX);
    const maxOwnerLaneX = d3.max(Array.from(ownerLaneX.values())) || rightMostNodeX + 120;
    const width = maxOwnerLaneX + spacing.marginX + 40;
    const height =
      spacing.marginY * 2 +
      maxRows * spacing.rowGap +
      spacing.nodeHeight +
      260;

    const levelRows = new Map();
    sortedLevels.forEach((lv) => {
      const levelNodes = (levels.get(lv) || []).slice().sort((a, b) => a.id.localeCompare(b.id));
      levelRows.set(
        lv,
        levelNodes.map((node, rowIndex) => ({
          id: node.id,
          rowIndex
        }))
      );
    });

    const rowByNode = new Map();
    levelRows.forEach((rows) => {
      rows.forEach((item) => {
        rowByNode.set(item.id, item.rowIndex);
      });
    });

    const positionedNodes = nodes.map((node) => {
      const lvIdx = levelIndex.get(node.level);
      const rowIndex = rowByNode.get(node.id) || 0;
      const x = spacing.marginX + lvIdx * spacing.levelGap;
      const y = spacing.marginY + rowIndex * spacing.rowGap;

      return {
        ...node,
        x,
        y,
        width: spacing.nodeWidth,
        height: spacing.nodeHeight,
        portInX: x,
        portOutX: x + spacing.nodeWidth,
        centerY: y + spacing.nodeHeight / 2
      };
    });

    const nodeById = new Map(positionedNodes.map((n) => [n.id, n]));
    const ownerRouteCounter = new Map();
    const topChannelY = spacing.marginY - spacing.routeOffset;
    const bottomChannelStartY = height - spacing.marginY + spacing.routeOffset;

    const positionedLinks = model.links.map((link) => {
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target) {
        return null;
      }

      const laneX = ownerLaneX.get(link.source) || rightMostNodeX + 80;

      const routeIndex = ownerRouteCounter.get(link.source) || 0;
      ownerRouteCounter.set(link.source, routeIndex + 1);

      const throughBottom = target.centerY >= source.centerY;
      const routeY = throughBottom
        ? bottomChannelStartY + routeIndex * spacing.edgeLaneGap
        : topChannelY - routeIndex * spacing.edgeLaneGap;

      const sourceExitX = source.portOutX + 12;
      const targetApproachX = target.portInX - 12;
      const start = [source.portOutX, source.centerY];
      const p2 = [sourceExitX, source.centerY];
      const p3 = [sourceExitX, routeY];
      const p4 = [laneX, routeY];
      const p5 = [targetApproachX, routeY];
      const p6 = [targetApproachX, target.centerY];
      const end = [target.portInX, target.centerY];

      return {
        ...link,
        color: this.ownerColor.get(link.source) || "#6f7c99",
        points: [start, p2, p3, p4, p5, p6, end],
        labelX: targetApproachX,
        labelY: routeY
      };
    }).filter(Boolean);

    return { width, height, nodes: positionedNodes, links: positionedLinks };
  }

  computeOwnerLaneX(outgoingByParent, rightMostNodeX) {
    const ownerLaneX = new Map();
    const owners = Array.from(outgoingByParent.keys()).sort((a, b) => a.localeCompare(b));
    const baseLaneX = rightMostNodeX + 80;

    owners.forEach((ownerId, index) => {
      const laneX = baseLaneX + index * spacing.edgeLaneGap;
      ownerLaneX.set(ownerId, laneX);
    });

    return ownerLaneX;
  }

  draw(layout) {
    this.container.selectAll("*").remove();

    const svg = this.container
      .append("svg")
      .attr("class", "chart-root")
      .attr("width", layout.width)
      .attr("height", layout.height);

    const defs = svg.append("defs");
    layout.links.forEach((link, idx) => {
      defs
        .append("marker")
        .attr("id", `arrow-${idx}`)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 9)
        .attr("refY", 5)
        .attr("markerWidth", 7)
        .attr("markerHeight", 7)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M 0 0 L 10 5 L 0 10 z")
        .attr("fill", link.color);
    });

    const linksLayer = svg.append("g").attr("class", "links-layer");
    const nodesLayer = svg.append("g").attr("class", "nodes-layer");
    const labelsLayer = svg.append("g").attr("class", "labels-layer");

    linksLayer
      .selectAll("path.edge")
      .data(layout.links)
      .enter()
      .append("path")
      .attr("class", "edge")
      .attr("d", (link) => this.orthogonalPath(link.points))
      .attr("fill", "none")
      .attr("stroke", (link) => link.color)
      .attr("stroke-width", 2)
      .attr("marker-end", (_, idx) => `url(#arrow-${idx})`);

    labelsLayer
      .selectAll("text.edge-label")
      .data(layout.links)
      .enter()
      .append("text")
      .attr("class", "edge-label")
      .attr("x", (link) => link.labelX)
      .attr("y", (link) => link.labelY - 8)
      .text((link) => link.share || "");

    const nodeGroups = nodesLayer
      .selectAll("g.node")
      .data(layout.nodes)
      .enter()
      .append("g")
      .attr("class", (node) => this.getNodeClass(node))
      .attr("transform", (node) => `translate(${node.x}, ${node.y})`);

    nodeGroups
      .append("rect")
      .attr("class", "node-card")
      .attr("width", spacing.nodeWidth)
      .attr("height", spacing.nodeHeight);

    nodeGroups
      .append("text")
      .attr("class", "node-title")
      .attr("x", 10)
      .attr("y", 22)
      .text((node) => node.id);

    nodeGroups
      .append("text")
      .attr("class", "node-meta")
      .attr("x", 10)
      .attr("y", 42)
      .text((node) => `level: ${node.level}`);

    this.applyTagStylesToSelection(nodeGroups);
  }

  orthogonalPath(points) {
    if (!points || points.length === 0) {
      return "";
    }
    const [start, ...rest] = points;
    const segments = rest.map((point) => `L ${point[0]} ${point[1]}`).join(" ");
    return `M ${start[0]} ${start[1]} ${segments}`;
  }

  getNodeClass(node) {
    const tags = node.tags || [];
    if (tags.length === 0) {
      return "node";
    }
    const classTags = tags.map((tag) => `tag-${String(tag).replace(/[^a-zA-Z0-9_-]/g, "_")}`);
    return `node ${classTags.join(" ")}`;
  }

  applyTagStylesToSelection(selection) {
    selection.each((node, index, groups) => {
      const g = d3.select(groups[index]);
      const card = g.select("rect.node-card");
      const nodeTags = node.tags || [];

      for (const tag of nodeTags) {
        const style = this.tagStyles[tag];
        if (!style) {
          continue;
        }

        if (style.fill) {
          card.attr("fill", style.fill);
        }
        if (style.stroke) {
          card.attr("stroke", style.stroke);
        }
        if (style.strokeWidth) {
          card.attr("stroke-width", style.strokeWidth);
        }
      }
    });
  }
}

function parseJsonFromTextarea(inputSelector) {
  const raw = document.querySelector(inputSelector).value.trim();
  if (!raw) {
    throw new Error("Поле ввода JSON пустое.");
  }
  return JSON.parse(raw);
}

function setMessage(text, isError = false) {
  const messageEl = document.querySelector("#message");
  messageEl.textContent = text;
  messageEl.className = `message ${isError ? "error" : "ok"}`;
}

function bootstrap() {
  const graph = new OwnershipGraph("#chart");

  const dataInput = document.querySelector("#dataInput");
  const tagStylesInput = document.querySelector("#tagStylesInput");

  dataInput.value = JSON.stringify(demoRelations, null, 2);
  tagStylesInput.value = JSON.stringify(demoTagStyles, null, 2);
  graph.setTagStyles(demoTagStyles);
  graph.render(demoRelations);

  document.querySelector("#renderButton").addEventListener("click", () => {
    try {
      const rows = parseJsonFromTextarea("#dataInput");
      graph.render(rows);
      setMessage("Схема успешно построена.");
    } catch (error) {
      setMessage(error.message || "Ошибка при построении схемы.", true);
    }
  });

  document.querySelector("#applyStylesButton").addEventListener("click", () => {
    try {
      const tagStyles = parseJsonFromTextarea("#tagStylesInput");
      graph.setTagStyles(tagStyles);
      const rows = parseJsonFromTextarea("#dataInput");
      graph.render(rows);
      setMessage("Стили меток применены.");
    } catch (error) {
      setMessage(error.message || "Ошибка при применении стилей.", true);
    }
  });
}

bootstrap();
