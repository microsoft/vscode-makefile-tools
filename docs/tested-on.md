scummvm: https://github.com/scummvm/scummvm.git
Works out of the box: ??? (verify if I fix the missing sdl-config not found error)
Special settings and configure steps: as described in issue 57
Known issues: none
Other notes, comments


linux kernel
Works out of the box:
   after cloning NO, if properly configured in the terminal YES
Special settings and configure steps
   remove --always-make from .... if dry-run starts to configure
Known issues
Other notes, comments
   - explain what happens when always-make off
   - watch dryrun for prompts to configure components (the timeout popup)

Sample Makefile for C++ - https://github.com/remonbonbon/makefile-example.git
Works out of the box: after cloning


ARMmbedTLS, https://github.com/ARMmbed/mbedtls.git
Works out of the box: after cloning


Embedded Makefile Flow, https://github.com/davepfeiffer/embedded-makefile-flow.git
Works out of the box: after cloning


Nano, https://github.com/madnight/nano.git
Works out of the box: after running ./autogen.sh && ./configure command in the terminal or via makefile.preconfigure command (executing for example .vscode/preconfigure.sh)
   Needs a build for all the headers to be found (they are generated during the build)
Special settings and configure steps: preconfigure.sh
Other notes, comments: The makefile extension doesn't even activate if the project is loaded in VSCode immediately after cloning, without running the configure steps.
                        You can force the activation by running makefile.preconfigure, after writing preconfigure.sh above, then run configure.
for me, it didn't work because build complains some things need to be installed and wasn't straight forward



CPython, https://github.com/python/cpython.git
Works out of the box: after preconfigure
Special settings and configure steps: preconfigure.sh and makefile.preconfigure


OpenJDK, https://github.com/openjdk/jdk.git
Other notes, comments: couldn't get preconfigure/configure to succeed because of needed installs 


TscanCode, https://github.com/Tencent/TscanCode.git
Works out of the box: no
Special settings and configure steps
   makefile.makefilePath + fix regarding makefilePath directory (otherwise, define configuration to pass -C)
Other notes, comments

8cc, https://github.com/rui314/8cc.git
Works out of the box: after cloning

Node, https://github.com/nodejs/node.git
Works out of the box: no
Special settings and configure steps
   preconfigure.sh: ./configure && /usr/bin/python3.7 tools/gyp_node.py -f make
   makefile.configurations: Debug --> ["BUILDTYPE=Debug -C out "]

gcc, https://github.com/gcc-mirror/gcc.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't install all that's needed

CMake, https://github.com/Kitware/CMake.git
Works out of the box: after preconfigure
Special settings and configure steps: preconfigure.sh: ./bootstrap
Known issues: doesn't detect launch targets because the linker commands are too cryptic. Maybe find a switch to expose linking better.
Other notes, comments

Lbrycrd, https://github.com/lbryio/lbrycrd.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments: the configure step didn't work, need to look closer at readmes


BusyBox, https://github.com/mirror/busybox.git
Works out of the box: after cloning
Other notes, comments: some files are renamed, copied around, we don't track configs for them
   workaround: craft a complete build log from which we fix the pahs for these files


SerenityOS, https://github.com/SerenityOS/serenity.git
Works out of the box: no
Special settings and configure steps
   define makefilePath
Known issues
Other notes, comments


ValveProton, https://github.com/ValveSoftware/Proton.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments: can't set it up


Google AFL, https://github.com/google/AFL.git
Works out of the box: after cloning
Special settings and configure steps
Known issues
Other notes, comments


UPX, https://github.com/upx/upx.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't set it up, make gives this error: please upgrade your UCL installation


VLC, https://github.com/videolan/vlc.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't set it up, first configure step fails


FreeBSD, https://github.com/freebsd/freebsd.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments: make doesn't do anything, what's BSD make syntax?
Same for OpenBSD, NetBSD and DragonFly_BSD


SystemMD, https://github.com/systemd/systemd.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   makefile wraps ninja, but if we find some switch or point to build log it can work!!!
   help me install ninja


ZFS, https://github.com/openzfs/zfs.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't configure

Wine, https://github.com/wine-mirror/wine.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't preconfigure, says to install 32 bit libraries


zinit, https://github.com/zdharma/zinit.git
Works out of the box: no
Special settings and configure steps
   point makefilePath to zmodules
Known issues
Other notes, comments
   no compilation commands
   Same for perl https://github.com/Perl/perl5.git


Git, https://github.com/git/git.git
Works out of the box: yes, except build/debug which needs preconfigure 
Special settings and configure steps
Known issues
Other notes, comments


qemu, https://github.com/qemu/qemu.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't configure, needs ninja


PHP, https://github.com/php/php-src.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't preconfigure, needs libxml-2.0 package


Mono, https://github.com/mono/mono.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments
   can't preconfigure, needs libtool


make, https://github.com/mirror/make.git
Works out of the box: after preconfigure (./bootstrap && ./configure)
Special settings and configure steps
Known issues
   - recursive make invocations, CD are interpreed wrong, sending good configs but for wrong paths <--> intellisense missing for files
Other notes, comments
   - configure takes long (because of non gcc stuff), use build log


LibreOffice, https://github.com/LibreOffice/core.git
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments


Name, Link
Works out of the box
Special settings and configure steps
Known issues
Other notes, comments


