"""Build and run the reading tool, admin UI and JSON-to-HTML API."""
import argparse
from build import build
from service import create_server

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--data-dir')
    parser.add_argument('--no-build', action='store_true', help='Use a prebuilt dist directory')
    args = parser.parse_args()
    if not args.no_build:
        build()
    server = create_server(args.host, args.port, args.data_dir)
    print(f'Open http://{args.host}:{args.port}/admin', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
