import { runDoctor as runDoctorImpl } from './doctorImpl.js'

export type {
  DoctorCheckStatus,
  DoctorCheck,
  DoctorReport,
  DoctorConfigContext,
  ConnectionTester,
  WritableDirChecker,
} from './doctorImpl.js'

export function runDoctor(...args: Parameters<typeof runDoctorImpl>): ReturnType<typeof runDoctorImpl> {
  return runDoctorImpl(...args)
}
