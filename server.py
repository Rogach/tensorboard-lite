import sys
import os
import glob
from time import time
import re
from datetime import datetime
from argparse import ArgumentParser
import asyncio
from threading import Thread
import traceback

import inotify
import inotify.adapters
from aiohttp import web
import warnings
warnings.simplefilter(action='ignore', category=FutureWarning)
import tensorflow as tf
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
tf.compat.v1.logging.set_verbosity(tf.compat.v1.logging.ERROR)
from tensorflow.python.summary.summary_iterator import summary_iterator
from tensorflow.python.framework.errors_impl import DataLossError


cli_parser = ArgumentParser()
cli_parser.add_argument("logs_dir")
args = cli_parser.parse_args()


def normalize_tag(tag, events_file):
    tag = re.sub("^epoch_", "", tag)
    if tag == "accuracy":
        tag = "acc"
    if os.path.basename(os.path.dirname(events_file)) == "validation" and not re.match("^val_", tag):
        tag = "val_" + tag
    return tag

def read_events_file(events_file, experiment_data):
    try:
        for event in list(summary_iterator(events_file)):
            if hasattr(event, "summary") and hasattr(event.summary, "value") and len(event.summary.value) > 0:
                value = event.summary.value[0]
                tag = value.tag
                if tag not in ["keras"]:
                    tag = normalize_tag(tag, events_file)
                    if tag not in experiment_data:
                        experiment_data[tag] = []
                    events = experiment_data[tag]
                    if event.step != len(events):
                        print(f"event step mismatch: expected {len(events)}, got {event.step} (file {events_file})", file=sys.stderr)
                    events.append(value.simple_value)
    except DataLossError:
        print(f"Warning: truncated file {events_file}", file=sys.stderr)


def read_events_dir(events_dir, experiment_data):
    for events_file in sorted(os.listdir(events_dir)):
        events_file = os.path.join(events_dir, events_file)
        if "tfevents" in events_file and os.path.isfile(events_file):
            read_events_file(events_file, experiment_data)

# we simply re-read the entire tree of logs
# didn't optimize it further because this is quite fast already - 50ms for the 100 log files
def load_data(logs_dir):
    start_time = time()
    experiments = {}
    for experiment_name in os.listdir(logs_dir):
        experiments[experiment_name] = experiment_data = {}
        experiment_dir = os.path.join(logs_dir, experiment_name)
        if os.path.isdir(experiment_dir):
            files = os.listdir(experiment_dir)
            if "train" in files:
                # Tensorflow v2
                read_events_dir(os.path.join(experiment_dir, "train"), experiment_data)
            if "validation" in files:
                # Tensorflow v2
                read_events_dir(os.path.join(experiment_dir, "validation"), experiment_data)
            # Tensorflow v1
            read_events_dir(experiment_dir, experiment_data)
    end_time = time()
    print(datetime.now().isoformat(), f"loaded data ({(end_time - start_time)*1000:.0f}ms)")
    return experiments


cached_data = load_data(args.logs_dir)
listening_sockets = []
event_loop = asyncio.get_event_loop()

async def send_to_all_sockets(data):
    global cached_data
    cached_data = data
    for ws in listening_sockets:
        await ws.send_json(data)

def listen_for_new_data():
    for event in inotify.adapters.InotifyTree(args.logs_dir).event_gen(yield_nones=False):
        _, event_types, path, filename = event
        # rsync first downloads the data to temporary file,
        # then moves the file to final location
        if "IN_MOVED_TO" in event_types:
            data = load_data(args.logs_dir)
            asyncio.run_coroutine_threadsafe(send_to_all_sockets(data), event_loop)
Thread(target=listen_for_new_data, args=[], daemon=True).start()


routes = web.RouteTableDef()

@routes.get("/")
async def handle_root(request):
    return web.FileResponse("./static/index.html")

@routes.get("/socket")
async def handle_socket(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    listening_sockets.append(ws)
    await ws.send_json(cached_data)
    async for _ in ws:
        pass
    listening_sockets.remove(ws)
    return ws

routes.static("/", "./static")

app = web.Application()
app.add_routes(routes)
web.run_app(app, port=6007)
