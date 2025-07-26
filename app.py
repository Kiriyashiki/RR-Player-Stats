import datetime
from math import ceil
from os import getenv

import requests
from dotenv import load_dotenv
from flask import Flask, render_template, request, abort

import util

load_dotenv()

app = Flask(__name__)

FLASK_HOST = getenv('FLASK_HOST', '127.0.0.1')
FLASK_PORT = int(getenv('FLASK_PORT', 8080))
DB_PATH = getenv('DB_PATH', './rr-player-stats.db')
API_URL = getenv('API_URL', 'http://127.0.0.1:8338')


@app.template_filter('prettydate')
def prettydate_filter(d):
    return util.prettydate(datetime.datetime.fromtimestamp(d / 1000, tz=datetime.UTC))


@app.template_filter('hhmm')
def hhmm_filter(minutes):
    return util.minutes_to_hours_minutes(minutes)


@app.route('/', methods=['GET'])
def index():
    return render_template("home.html")


@app.route('/faq', methods=['GET'])
def faq():
    return render_template("faq.html")


@app.route('/profile')
def show_player():
    # either ?pid=… or ?fc=…
    pid = request.args.get('pid')
    fc = request.args.get('fc')
    if not pid and not fc:
        abort(400, "Provide pid or fc")

    # call your API
    params = {}
    if pid:
        params['pid'] = pid
    else:
        params['fc'] = fc

    try:
        resp = requests.get(f"{API_URL}/player", params=params, timeout=15)
        if resp.status_code == 404:
            abort(404, "Player not found")
        if not resp.ok:
            abort(resp.status_code)

        player = resp.json()

        resp2 = requests.get(f"{API_URL}/vrhistory/{player['pid']}", timeout=15)
        if not resp2.ok:
            vrhist = {}
        else:
            vrhist = resp2.json()

        now_ms = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
        windows = [
            ('12h', 12 * 3600 * 1000),
            ('24h', 24 * 3600 * 1000),
            ('7d', 7 * 24 * 3600 * 1000),
            ('24d', 24 * 24 * 3600 * 1000),
        ]

        history = vrhist['history']

        stats = {}
        # ensure sorted ascending by time
        history.sort(key=lambda e: e['timestamp'])
        for label, span in windows:
            cutoff = now_ms - span
            # take only points >= cutoff
            slice_ = [e['vr'] for e in history if e['timestamp'] >= cutoff]
            if not slice_:
                stats[label] = {'change': 0, 'gains': 0, 'losses': 0}
                continue

            # change = last - first
            change = slice_[-1] - slice_[0]

            # compute gains & losses
            gains = 0
            losses = 0
            prev = slice_[0]
            for cur in slice_[1:]:
                diff = cur - prev
                if diff > 0:
                    gains += diff
                else:
                    losses += -diff
                prev = cur

            stats[label] = {'change': change, 'gains': gains, 'losses': losses}

        pt = 0
        prev = 0
        for e in history:
            if 150000 <= (e['timestamp'] - prev) <= 450000:
                pt += 5
            prev = e['timestamp']

        player['pt'] = pt

        # render profile.html
        return render_template('player.html',
                               player=player,
                               vrhist=vrhist,
                               stats=stats)
    except requests.exceptions.RequestException as e:
        print("Error fetching profile: {}".format(e))
        return render_template('500.html', page='/profile', err="[ERR_DB_CONNECTION_FAILED]", params=params), 500
    except Exception as e:
        print("Error fetching profile: {}".format(e))
        return render_template('500.html', page='/profile', err="[ERR_DB_FETCH_FAILED]", params=params), 500

@app.route('/leaderboard')
def show_leaderboard():
    PER_PAGE = 200

    # which page?
    try:
        page = int(request.args.get('page', 1))
        if page < 1:
            raise ValueError()
    except ValueError:
        abort(400, "Invalid page")

    # optional search query
    q = request.args.get('q', '').strip()

    start = (page - 1) * PER_PAGE + 1
    end = start + PER_PAGE - 1

    # build params
    params = {'start': start, 'end': end}
    if q:
        params['q'] = q

    # fetch from API
    try:
        resp = requests.get(f"{API_URL}/leaderboard", params=params, timeout=15)
        if not resp.ok:
            abort(resp.status_code)

        data = resp.json()
        players = data['players']
        total_count = data['total_count']
        last_ref = data['last_refresh']

        total_pages = ceil(total_count / PER_PAGE)

        return render_template(
            'leaderboard.html',
            players=players,
            page=page,
            total_pages=total_pages,
            last_refresh=last_ref,
            q=q,
        )
    except requests.exceptions.RequestException as e:
        print("Error fetching leaderboard: {}".format(e))
        return render_template('500.html', page='/leaderboard', err="[ERR_DB_CONNECTION_FAILED]", params=params), 500
    except Exception as e:
        print("Error fetching leaderboard: {}".format(e))
        return render_template('500.html', page='/leaderboard', err="[ERR_DB_FETCH_FAILED]", params=params), 500

if __name__ == '__main__':
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=False)
