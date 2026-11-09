#!/usr/bin/env python3
"""Fundstueck adapter for Blocket (Sweden). Outputs JSON list of listings."""
import json, sys, argparse
from blocket_api import BlocketAPI

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('query')
    ap.add_argument('--max-results', type=int, default=20)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    b = BlocketAPI()
    out = []
    page = 1
    while len(out) < args.max_results:
        r = b.search(args.query, page=page)
        docs = r.get('docs', [])
        if not docs:
            break
        for d in docs:
            price = d.get('price') or {}
            out.append({
                'id': str(d.get('ad_id') or d.get('id')),
                'title': d.get('heading'),
                'price': price.get('amount'),
                'currency': price.get('currency_code', 'SEK'),
                'location': d.get('location'),
                'image': (d.get('image_urls') or [None])[0] if d.get('image_urls') else d.get('image'),
                'url': d.get('canonical_url'),
                'publishedAt': None,
            })
            if len(out) >= args.max_results:
                break
        page += 1
        if page > 5:
            break

    if args.out:
        with open(args.out, 'w') as f:
            json.dump(out, f)
    else:
        print(json.dumps(out))

if __name__ == '__main__':
    main()
