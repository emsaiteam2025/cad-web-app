import sys
import os

project_home = '/home/a14008/cad-web-app'
if project_home not in sys.path:
    sys.path.insert(0, project_home)
os.chdir(project_home)

_application = None

def application(environ, start_response):
    global _application
    if _application is None:
        from a2wsgi import ASGIMiddleware
        from main import app as fastapi_app
        _application = ASGIMiddleware(fastapi_app)
    return _application(environ, start_response)
