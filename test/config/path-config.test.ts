import path from "path"
import { getPackageDir } from "../../src/config/path-config.ts"

const main = () => {
    // const fdPath = path.resolve(getPackageDir(), "/bin/fd")
    console.log(path.join(getPackageDir(), "bin", "fd"))
}

main()
