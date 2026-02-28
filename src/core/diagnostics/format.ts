import { formatDoctorHuman as formatDoctorHumanImpl, formatStatusHuman as formatStatusHumanImpl } from './formatImpl.js'

export function formatDoctorHuman(...args: Parameters<typeof formatDoctorHumanImpl>): ReturnType<typeof formatDoctorHumanImpl> {
  return formatDoctorHumanImpl(...args)
}

export function formatStatusHuman(...args: Parameters<typeof formatStatusHumanImpl>): ReturnType<typeof formatStatusHumanImpl> {
  return formatStatusHumanImpl(...args)
}
