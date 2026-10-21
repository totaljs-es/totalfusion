try:
    import definitely_optional_pkg_xyz
except ImportError:
    definitely_optional_pkg_xyz = None


def available(data):
    return definitely_optional_pkg_xyz is not None
