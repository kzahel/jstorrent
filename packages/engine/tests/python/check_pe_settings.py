import libtorrent as lt
try:
    ps = lt.pe_settings()
    print("pe_settings exists")
except AttributeError:
    print("pe_settings does NOT exist")

try:
    ses = lt.session()
    ses.set_pe_settings(lt.pe_settings())
    print("set_pe_settings exists")
except AttributeError:
    print("set_pe_settings does NOT exist")
