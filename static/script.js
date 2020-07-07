let h = React.createElement;

let App = () => {
  let [data, setData] = React.useState({});
  let [deselected, setDeselected] = React.useState(Immutable.Set(JSON.parse(localStorage["deselected"] || "[]")));
  let [colors, setColors] = React.useState(Immutable.Map(JSON.parse(localStorage["colors"] || "{}")));

  React.useEffect(() => {
    let socket = new ReconnectingWebSocket("ws://" + location.host + "/socket");
    socket.addEventListener("message", e => {
      setData(JSON.parse(e.data));
    });
    return () => {
      socket.close();
    };
  }, []);

  React.useEffect(() => {
    localStorage["deselected"] = JSON.stringify(deselected.toJSON());
    localStorage["colors"] = JSON.stringify(colors.toJSON());
  });

  return h(
    "div", {className: "container"},
    h(Roster, {
      data: data,
      deselected: deselected,
      setDeselected: setDeselected,
      colors: colors,
      setColors: setColors,
    }),

    h(ChartContainer, {
      gridRow: 1, gridColumn: 2,
      data: data, deselected: deselected, colors: colors,
      seriesName: "loss"
    }),
    h(ChartContainer, {
      gridRow: 1, gridColumn: 3,
      data: data, deselected: deselected, colors: colors,
      seriesName: "acc"
    }),
    h(ChartContainer, {
      gridRow: 1, gridColumn: 4,
      data: data, deselected: deselected, colors: colors,
      seriesName: "fp"
    }),
    h(ChartContainer, {
      gridRow: 1, gridColumn: 5,
      data: data, deselected: deselected, colors: colors,
      seriesName: "fn"
    }),

    h(ChartContainer, {
      gridRow: 2, gridColumn: 2,
      data: data, deselected: deselected, colors: colors,
      seriesName: "val_loss"
    }),
    h(ChartContainer, {
      gridRow: 2, gridColumn: 3,
      data: data, deselected: deselected, colors: colors,
      seriesName: "val_acc"
    }),
    h(ChartContainer, {
      gridRow: 2, gridColumn: 4,
      data: data, deselected: deselected, colors: colors,
      seriesName: "val_fp"
    }),
    h(ChartContainer, {
      gridRow: 2, gridColumn: 5,
      data: data, deselected: deselected, colors: colors,
      seriesName: "val_fn"
    }),
  );
};

let Roster = (props) => {
  return h(
    "div", {className: "roster"},
    h(
      "div", {className: "experiment-row all"},
      h("input", {
        type: "checkbox",
        checked: props.deselected.size == 0,
        onChange: (e) => {
          if (e.target.checked) {
            props.setDeselected(props.deselected.clear());
          } else {
            props.setDeselected(props.deselected.union(Object.keys(props.data)));
          }
        }
      }),
      h("span", null, "All"),
      h("button", {
        className: "reset-colors",
        onClick: () => {
          props.setColors(Immutable.Map());
        }
      }, "↻"),
    ),
    _.chain(props.data).entries().sortBy(0).reverse().map(([name, series]) =>
      h(ExperimentRow, {
        key: name,
        name: name,
        series: series,
        isSelected: !props.deselected.has(name),
        onSelectionChange: (s) => {
          if (s) {
            props.setDeselected(props.deselected.delete(name));
          } else if (!s) {
            props.setDeselected(props.deselected.add(name));
          }
        },
        color: props.colors.get(name),
        onColorChange: (c) => props.setColors(props.colors.set(name, c))
      })
    ).value()
  )
};

let ExperimentRow = (props) => {
  return h(
    "div", {className: "experiment-row"},
    h("input", {
      type: "checkbox",
      checked: props.isSelected,
      onChange: (e) => props.onSelectionChange(e.target.checked)
    }),
    h("span", {
      className: "name",
      onClick: () => props.onSelectionChange(!props.isSelected)
    }, props.name),
    h("span", {
      className: "shuffle",
      onClick: () => {
        let newColor;
        do {
          newColor = palette[Math.floor(Math.random() * 10)];
        } while (newColor === props.color);
        props.onColorChange(newColor);
      }
    }, "🔀"),
    h("input", {
      type: "color",
      value: props.color || defaultColor(props.name),
      onChange: (e) => props.onColorChange(e.target.value)
    }),
  );
};


let ChartContainer = (props) => {
  let chart = React.useRef();
  let chartCanvasRef = React.useRef();
  React.useEffect(() => {
    let chartOptions = createChartOptions(props.data, props.deselected, props.colors, props.seriesName);
    chart.current = new Chart(chartCanvasRef.current.getContext("2d"), chartOptions);
  }, []);

  React.useEffect(() => {
    chart.current.data.datasets = createChartDatasets(props.data, props.deselected, props.colors, props.seriesName);
    chart.current.update();
  }, [props.data, props.deselected, props.colors, props.seriesName])

  return h(
    "div", {className: "chart-container", style: {gridRow: props.gridRow, gridColumn: props.gridColumn}},
    h("canvas", {ref: chartCanvasRef, width: 400, height: 400})
  );
};

function createChartOptions(data, deselected, colors, seriesName) {
  let opts = {
    type: "line",
    data: {
      datasets: createChartDatasets(data, deselected, colors, seriesName)
    },
    options: {
      animation: { duration: 0 },
      hover: { animationDuration: 0 },
      title: {
        display: true,
        text: seriesName
      },
      legend: { display: false },
      tooltips: {
        caretPadding: 15,
        mode: "index",
      },
      scales: {
        xAxes: [{
          type: "linear",
        }],
      }
    }
  };

  return opts;
}

function createChartDatasets(data, deselected, colors, seriesName) {
  let datasets = [];
  _.chain(data).entries().sortBy(0).reverse().forEach(([name, series]) => {
    if (!deselected.has(name) && _.has(series, seriesName)) {
      datasets.push({
        label: name,
        data: _.map(series[seriesName], (v, i) => ({x: i+1, y: v})),
        fill: false,
        lineTension: 0,
        pointRadius: series[seriesName].length > 1 ? 0 : 3,
        pointHitRadius: 5,
        borderColor: colors.get(name) || defaultColor(name),
        borderWidth: 2,
      });
    }
  }).value();
  return datasets;
}

let palette = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
];

function defaultColor(name) {
  let h = Math.abs(strHashCode(name));
  return palette[h % palette.length];
}

function strHashCode(s) {
    var hash = 0;
    if (s.length == 0) {
        return hash;
    }
    for (var i = 0; i < s.length; i++) {
        var char = s.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

ReactDOM.render(h(App), document.getElementById("root"));
