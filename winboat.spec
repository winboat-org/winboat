%global bun_version 1.2.19

%global bun_arch %{_arch}
%ifarch x86_64
%global bun_arch x64
%endif

Name:           winboat
Version:        0.9.0
Release:        1%{?dist}
Summary:        <one line>
License:        <SPDX id>
URL:            https://github.com/easton57/winboat
Source0:        %{url}/archive/refs/tags/%{version}/%{name}-%{version}.tar.gz
Source1:        https://github.com/oven-sh/bun/releases/download/bun-v%{bun_version}/bun-linux-%{bun_arch}.zip

BuildRequires:  unzip
BuildRequires:  git
BuildRequires:  golang
BuildRequires:  libxcrypt

%description
<longer description>

%prep
%autosetup -n %{name}-%{version}

%build
mkdir -p bun-bin
unzip -o %{SOURCE1} -d bun-bin
export PATH=%{_builddir}/%{name}-%{version}/bun-bin/bun-linux-%{bun_arch}:$PATH
export HOME=%{_builddir}
bun install --frozen-lockfile
bun run build:linux-gs

%install
install -d %{buildroot}%{_libdir}/%{name}
cp -r dist/* %{buildroot}%{_libdir}/%{name}/
install -Dm755 bun-bin/bun-linux-%{bun_arch}/bun %{buildroot}%{_libdir}/%{name}/bun
install -Dm755 %{_builddir}/%{name}-%{version}/launcher.sh %{buildroot}%{_bindir}/%{name}

%files
%{_bindir}/%{name}
%{_libdir}/%{name}

%changelog
* Fri Aug 28 2026 Easton Seidel <eastonseidel@proton.me> - 0.9.0-1
- Initial package